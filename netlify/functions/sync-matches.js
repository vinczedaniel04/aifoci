const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

 if (!supabaseUrl || !supabaseKey) {
 return {
 statusCode: 500,
 headers: {
 "content-type": "application/json"
 },
 body: JSON.stringify({
 error: "Hiányzó SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY"
 })
 };
 }

 const supabase = createClient(supabaseUrl, supabaseKey);

 function getTodayUtcDate() {
 const now = new Date();
 return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
 now.getUTCDate()
 ).padStart(2, "0")}`;
 }

 const matchDay = getTodayUtcDate();

 function factorial(n) {
 if (n <= 1) return 1;
 let result = 1;
 for (let i = 2; i <= n; i += 1) result *= i;
 return result;
 }

 function poisson(lambda, k) {
 return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
 }

 function estimateCorners(expectedHomeGoals, expectedAwayGoals) {
 const totalExpectedGoals = expectedHomeGoals + expectedAwayGoals;
 const safeTotal = totalExpectedGoals <= 0 ? 0.1 : totalExpectedGoals;
 const baseCorners = 8.0;
 const totalCorners = baseCorners + totalExpectedGoals * 1.9;

 return {
 total: Number(totalCorners.toFixed(2)),
 home: Number((totalCorners * (expectedHomeGoals / safeTotal)).toFixed(2)),
 away: Number((totalCorners * (expectedAwayGoals / safeTotal)).toFixed(2))
 };
 }

 function estimateCards(expectedHomeGoals, expectedAwayGoals) {
 const totalExpectedGoals = expectedHomeGoals + expectedAwayGoals;
 const goalDiff = Math.abs(expectedHomeGoals - expectedAwayGoals);

 let totalCards = 3.6;

 if (goalDiff < 0.4) totalCards += 1.1;
 else if (goalDiff < 0.8) totalCards += 0.6;

 if (totalExpectedGoals < 2.2) totalCards += 0.8;
 else if (totalExpectedGoals > 3.2) totalCards -= 0.3;

 return {
 total: Number(totalCards.toFixed(2))
 };
 }

 function predictMatch(match, homeForm, awayForm) {
 const homeAttack =
 Number(homeForm.avg_goals_for_home ?? homeForm.avg_goals_for ?? 1.2);
 const homeDefense =
 Number(homeForm.avg_goals_against_home ?? homeForm.avg_goals_against ?? 1.2);

 const awayAttack =
 Number(awayForm.avg_goals_for_away ?? awayForm.avg_goals_for ?? 1.0);
 const awayDefense =
 Number(awayForm.avg_goals_against_away ?? awayForm.avg_goals_against ?? 1.0);

 const expectedHomeGoals = ((homeAttack + awayDefense) / 2) + 0.15;
 const expectedAwayGoals = (awayAttack + homeDefense) / 2;

 let bestProbability = 0;
 let bestScore = "0-0";
 let over25 = 0;
 let btts = 0;

 for (let h = 0; h <= 5; h += 1) {
 for (let a = 0; a <= 5; a += 1) {
 const probability =
 poisson(expectedHomeGoals, h) * poisson(expectedAwayGoals, a);

 if (probability > bestProbability) {
 bestProbability = probability;
 bestScore = `${h}-${a}`;
 }

 if (h + a >= 3) over25 += probability;
 if (h > 0 && a > 0) btts += probability;
 }
 }

 const corners = estimateCorners(expectedHomeGoals, expectedAwayGoals);
 const cards = estimateCards(expectedHomeGoals, expectedAwayGoals);

 const strongerSide =
 expectedHomeGoals >= expectedAwayGoals
 ? match.home_team_name
 : match.away_team_name;

 return {
 predicted_score: bestScore,
 predicted_home_goals: Number(expectedHomeGoals.toFixed(2)),
 predicted_away_goals: Number(expectedAwayGoals.toFixed(2)),
 predicted_over25_probability: Number((over25 * 100).toFixed(2)),
 predicted_btts_probability: Number((btts * 100).toFixed(2)),
 predicted_corners_total: corners.total,
 predicted_cards_total: cards.total,
 explanation: `A modell 10 hazai és 10 idegenbeli szezonmeccsből számol. A várható gólok alapján ${match.home_team_name} ${expectedHomeGoals.toFixed(
 2
 )}, ${match.away_team_name} ${expectedAwayGoals.toFixed(
 2
 )}. Enyhe fölényben van: ${strongerSide}.`
 };
 }

 const { data: matches, error: matchesError } = await supabase
 .from("matches")
 .select("*")
 .order("match_date", { ascending: true });

 if (matchesError) throw matchesError;

 const { data: formRows, error: formError } = await supabase
 .from("team_form_cache")
 .select("*")
 .eq("match_day", matchDay);

 if (formError) throw formError;

 const { data: existingPredictions, error: existingPredictionsError } = await supabase
 .from("predictions_history")
 .select("match_id");

 if (existingPredictionsError) throw existingPredictionsError;

 const existingPredictionIds = new Set(
 (existingPredictions || []).map((row) => row.match_id)
 );

 const formMap = new Map();
 for (const row of formRows || []) {
 formMap.set(row.team_id, row);
 }

 const rowsToInsert = [];
 const rowsToUpdate = [];

 for (const match of matches || []) {
 const homeForm = formMap.get(match.home_team_id);
 const awayForm = formMap.get(match.away_team_id);

 if (!homeForm || !awayForm) {
 continue;
 }

 const isFinished = (match.status || "").toUpperCase() === "FINISHED";
 const actualTotal = isFinished
 ? (match.full_time_home ?? 0) + (match.full_time_away ?? 0)
 : null;
 const actualBtts = isFinished
 ? (match.full_time_home ?? 0) > 0 && (match.full_time_away ?? 0) > 0
 : null;

 if (existingPredictionIds.has(match.match_id)) {
 rowsToUpdate.push({
 match_id: match.match_id,
 status: match.status,
 live_home: match.live_home ?? null,
 live_away: match.live_away ?? null,
 minute: match.minute ?? null,
 actual_home_goals: isFinished ? match.full_time_home : null,
 actual_away_goals: isFinished ? match.full_time_away : null,
 updated_at: new Date().toISOString()
 });

 continue;
 }

 const prediction = predictMatch(match, homeForm, awayForm);
 const actualScore = isFinished
 ? `${match.full_time_home ?? 0}-${match.full_time_away ?? 0}`
 : null;

 rowsToInsert.push({
 match_id: match.match_id,
 match_date: match.match_date,
 competition_code: match.competition_code,
 competition_name: match.competition_name,
 competition_emblem: match.competition_emblem || null,
 status: match.status,

 home_team_name: match.home_team_name,
 away_team_name: match.away_team_name,
 home_team_crest: match.home_team_crest || null,
 away_team_crest: match.away_team_crest || null,

 live_home: match.live_home ?? null,
 live_away: match.live_away ?? null,
 minute: match.minute ?? null,

 predicted_score: prediction.predicted_score,
 predicted_home_goals: prediction.predicted_home_goals,
 predicted_away_goals: prediction.predicted_away_goals,
 predicted_over25_probability: prediction.predicted_over25_probability,
 predicted_btts_probability: prediction.predicted_btts_probability,
 predicted_corners_total: prediction.predicted_corners_total,
 predicted_cards_total: prediction.predicted_cards_total,
 explanation: prediction.explanation,

 actual_home_goals: isFinished ? match.full_time_home : null,
 actual_away_goals: isFinished ? match.full_time_away : null,
 exact_hit: isFinished ? prediction.predicted_score === actualScore : null,
 over25_hit: isFinished
 ? (prediction.predicted_over25_probability >= 50) === (actualTotal > 2.5)
 : null,
 btts_hit: isFinished
 ? (prediction.predicted_btts_probability >= 50) === actualBtts
 : null,

 updated_at: new Date().toISOString()
 });
 }

 if (rowsToInsert.length > 0) {
 const { error: insertError } = await supabase
 .from("predictions_history")
 .upsert(rowsToInsert, { onConflict: "match_id" });

 if (insertError) throw insertError;
 }

 for (const row of rowsToUpdate) {
 const { data: existingRow, error: existingRowError } = await supabase
 .from("predictions_history")
 .select(
 "predicted_score, predicted_over25_probability, predicted_btts_probability"
 )
 .eq("match_id", row.match_id)
 .maybeSingle();

 if (existingRowError) throw existingRowError;
 if (!existingRow) continue;

 const isFinished = (row.status || "").toUpperCase() === "FINISHED";

 let exact_hit = null;
 let over25_hit = null;
 let btts_hit = null;

 if (isFinished) {
 const actualScore = `${row.actual_home_goals ?? 0}-${row.actual_away_goals ?? 0}`;
 const actualTotal = (row.actual_home_goals ?? 0) + (row.actual_away_goals ?? 0);
 const actualBtts =
 (row.actual_home_goals ?? 0) > 0 && (row.actual_away_goals ?? 0) > 0;

 exact_hit = existingRow.predicted_score === actualScore;
 over25_hit =
 (Number(existingRow.predicted_over25_probability || 0) >= 50) ===
 (actualTotal > 2.5);
 btts_hit =
 (Number(existingRow.predicted_btts_probability || 0) >= 50) ===
 actualBtts;
 }

 const { error: updateError } = await supabase
 .from("predictions_history")
 .update({
 status: row.status,
 live_home: row.live_home,
 live_away: row.live_away,
 minute: row.minute,
 actual_home_goals: row.actual_home_goals,
 actual_away_goals: row.actual_away_goals,
 exact_hit,
 over25_hit,
 btts_hit,
 updated_at: row.updated_at
 })
 .eq("match_id", row.match_id);

 if (updateError) throw updateError;
 }

 return {
 statusCode: 200,
 headers: {
 "content-type": "application/json"
 },
 body: JSON.stringify({
 ok: true,
 inserted: rowsToInsert.length,
 updated: rowsToUpdate.length,
 match_day: matchDay
 })
 };
 } catch (error) {
 return {
 statusCode: 500,
 headers: {
 "content-type": "application/json"
 },
 body: JSON.stringify({
 error: error.message || "Ismeretlen hiba"
 })
 };
 }
};