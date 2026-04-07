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
 const totalCorners = baseCorners + totalExpectedGoals * 1.75;

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

 if (goalDiff < 0.35) totalCards += 1.0;
 else if (goalDiff < 0.7) totalCards += 0.5;

 if (totalExpectedGoals < 2.2) totalCards += 0.6;
 else if (totalExpectedGoals > 3.4) totalCards -= 0.2;

 return {
 total: Number(totalCards.toFixed(2))
 };
 }

 function clamp(value, min, max) {
 return Math.max(min, Math.min(max, value));
 }

 function predictMatch(match, homeForm, awayForm) {
 const homeAttack = Number(homeForm.avg_goals_for_home ?? homeForm.avg_goals_for ?? 1.2);
 const homeDefense = Number(homeForm.avg_goals_against_home ?? homeForm.avg_goals_against ?? 1.2);

 const awayAttack = Number(awayForm.avg_goals_for_away ?? awayForm.avg_goals_for ?? 1.0);
 const awayDefense = Number(awayForm.avg_goals_against_away ?? awayForm.avg_goals_against ?? 1.0);

 const homeWinRate = Number(homeForm.home_win_rate ?? 0);
 const awayWinRate = Number(awayForm.away_win_rate ?? 0);

 const homeFormBoost = (homeWinRate - awayWinRate) / 400;
 const homeAdvantage = 0.08;

 let expectedHomeGoals =
 ((homeAttack + awayDefense) / 2) + homeAdvantage + homeFormBoost;

 let expectedAwayGoals =
 ((awayAttack + homeDefense) / 2) - (homeFormBoost / 2);

 expectedHomeGoals = clamp(Number(expectedHomeGoals.toFixed(2)), 0.2, 3.2);
 expectedAwayGoals = clamp(Number(expectedAwayGoals.toFixed(2)), 0.2, 3.0);

 let bestProbability = 0;
 let bestScore = "0-0";
 let over25 = 0;
 let btts = 0;
 let homeWin = 0;
 let draw = 0;
 let awayWin = 0;

 for (let h = 0; h <= 6; h += 1) {
 for (let a = 0; a <= 6; a += 1) {
 const probability =
 poisson(expectedHomeGoals, h) * poisson(expectedAwayGoals, a);

 if (probability > bestProbability) {
 bestProbability = probability;
 bestScore = `${h}-${a}`;
 }

 if (h + a >= 3) over25 += probability;
 if (h > 0 && a > 0) btts += probability;

 if (h > a) homeWin += probability;
 else if (h === a) draw += probability;
 else awayWin += probability;
 }
 }

 const probabilitySum = homeWin + draw + awayWin;

 if (probabilitySum > 0) {
 homeWin /= probabilitySum;
 draw /= probabilitySum;
 awayWin /= probabilitySum;
 }

 const corners = estimateCorners(expectedHomeGoals, expectedAwayGoals);
 const cards = estimateCards(expectedHomeGoals, expectedAwayGoals);

 const totalGoals = expectedHomeGoals + expectedAwayGoals;

 let finalOver25Tip = "2,5 ALATT";
 if (over25 >= 0.6 && totalGoals >= 2.6) {
 finalOver25Tip = "2,5 FELETT";
 }

 let finalBttsTip = "NG";
 if (btts >= 0.6 && expectedHomeGoals >= 0.95 && expectedAwayGoals >= 0.95) {
 finalBttsTip = "GG";
 }

 const strongerSide =
 expectedHomeGoals >= expectedAwayGoals
 ? match.home_team_name
 : match.away_team_name;

 return {
 predicted_score: bestScore,
 predicted_home_goals: Number(expectedHomeGoals.toFixed(2)),
 predicted_away_goals: Number(expectedAwayGoals.toFixed(2)),
 predicted_total_goals: Number(totalGoals.toFixed(2)),
 predicted_over25_probability: Number((over25 * 100).toFixed(2)),
 predicted_btts_probability: Number((btts * 100).toFixed(2)),
 predicted_home_win_probability: Number((homeWin * 100).toFixed(2)),
 predicted_draw_probability: Number((draw * 100).toFixed(2)),
 predicted_away_win_probability: Number((awayWin * 100).toFixed(2)),
 predicted_corners_total: corners.total,
 predicted_cards_total: cards.total,
 final_over25_tip: finalOver25Tip,
 final_btts_tip: finalBttsTip,
 explanation: `A modell súlyozott, 15 hazai és 15 idegenbeli szezonmeccsből számol. A várható gólok alapján ${match.home_team_name} ${expectedHomeGoals.toFixed(
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
 .select("*");

 if (existingPredictionsError) throw existingPredictionsError;

 const existingPredictionMap = new Map();
 for (const row of existingPredictions || []) {
 existingPredictionMap.set(row.match_id, row);
 }

 const formMap = new Map();
 for (const row of formRows || []) {
 formMap.set(row.team_id, row);
 }

 const rowsToInsert = [];
 const rowsToUpdateUnlocked = [];
 const rowsToUpdateLocked = [];
 const rowsToPatch1X2 = [];

 for (const match of matches || []) {
 const homeForm = formMap.get(match.home_team_id);
 const awayForm = formMap.get(match.away_team_id);

 if (!homeForm || !awayForm) {
 continue;
 }

 const existingPrediction = existingPredictionMap.get(match.match_id);

 const statusUpper = (match.status || "").toUpperCase();
 const isFinished = statusUpper === "FINISHED";
 const isLockedStatus = ["LIVE", "IN_PLAY", "PAUSED", "FINISHED"].includes(statusUpper);

 const actualTotal = isFinished
 ? (match.full_time_home ?? 0) + (match.full_time_away ?? 0)
 : null;

 const actualBtts = isFinished
 ? (match.full_time_home ?? 0) > 0 && (match.full_time_away ?? 0) > 0
 : null;

 const actualScore = isFinished
 ? `${match.full_time_home ?? 0}-${match.full_time_away ?? 0}`
 : null;

 const prediction = predictMatch(match, homeForm, awayForm);

 if (existingPrediction && isLockedStatus) {
 const missing1X2 =
 existingPrediction.predicted_home_win_probability == null ||
 existingPrediction.predicted_draw_probability == null ||
 existingPrediction.predicted_away_win_probability == null;

 if (missing1X2) {
 rowsToPatch1X2.push({
 match_id: match.match_id,
 predicted_home_win_probability: prediction.predicted_home_win_probability,
 predicted_draw_probability: prediction.predicted_draw_probability,
 predicted_away_win_probability: prediction.predicted_away_win_probability,
 updated_at: new Date().toISOString()
 });
 }

 rowsToUpdateLocked.push({
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

 const predictionRow = {
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
 predicted_home_win_probability: prediction.predicted_home_win_probability,
 predicted_draw_probability: prediction.predicted_draw_probability,
 predicted_away_win_probability: prediction.predicted_away_win_probability,
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
 };

 if (existingPrediction) {
 rowsToUpdateUnlocked.push(predictionRow);
 } else {
 rowsToInsert.push(predictionRow);
 }
 }

 if (rowsToInsert.length > 0) {
 const { error: insertError } = await supabase
 .from("predictions_history")
 .upsert(rowsToInsert, { onConflict: "match_id" });

 if (insertError) throw insertError;
 }

 for (const row of rowsToPatch1X2) {
 const { error: patchError } = await supabase
 .from("predictions_history")
 .update({
 predicted_home_win_probability: row.predicted_home_win_probability,
 predicted_draw_probability: row.predicted_draw_probability,
 predicted_away_win_probability: row.predicted_away_win_probability,
 updated_at: row.updated_at
 })
 .eq("match_id", row.match_id);

 if (patchError) throw patchError;
 }

 for (const row of rowsToUpdateLocked) {
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

 for (const row of rowsToUpdateUnlocked) {
 const { error: updateError } = await supabase
 .from("predictions_history")
 .update({
 match_date: row.match_date,
 competition_code: row.competition_code,
 competition_name: row.competition_name,
 competition_emblem: row.competition_emblem,
 status: row.status,

 home_team_name: row.home_team_name,
 away_team_name: row.away_team_name,
 home_team_crest: row.home_team_crest,
 away_team_crest: row.away_team_crest,

 live_home: row.live_home,
 live_away: row.live_away,
 minute: row.minute,

 predicted_score: row.predicted_score,
 predicted_home_goals: row.predicted_home_goals,
 predicted_away_goals: row.predicted_away_goals,
 predicted_over25_probability: row.predicted_over25_probability,
 predicted_btts_probability: row.predicted_btts_probability,
 predicted_home_win_probability: row.predicted_home_win_probability,
 predicted_draw_probability: row.predicted_draw_probability,
 predicted_away_win_probability: row.predicted_away_win_probability,
 predicted_corners_total: row.predicted_corners_total,
 predicted_cards_total: row.predicted_cards_total,
 explanation: row.explanation,

 actual_home_goals: row.actual_home_goals,
 actual_away_goals: row.actual_away_goals,
 exact_hit: row.exact_hit,
 over25_hit: row.over25_hit,
 btts_hit: row.btts_hit,
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
 updated_locked: rowsToUpdateLocked.length,
 updated_unlocked: rowsToUpdateUnlocked.length,
 patched_1x2_locked: rowsToPatch1X2.length,
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