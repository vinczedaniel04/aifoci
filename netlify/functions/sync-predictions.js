const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

 if (!supabaseUrl || !supabaseKey) {
 return {
 statusCode: 500,
 headers: { "content-type": "application/json" },
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

 function clamp(value, min, max) {
 return Math.max(min, Math.min(max, value));
 }

 function softCapRate(ratePercent) {
 const safe = Math.min(Number(ratePercent || 0), 72);
 return safe / 100;
 }

 function regressTowardMean(value, mean = 1.55, strength = 0.35) {
 return (value * (1 - strength)) + (mean * strength);
 }

 function estimateCorners(expectedHomeGoals, expectedAwayGoals) {
 const totalExpectedGoals = expectedHomeGoals + expectedAwayGoals;
 const safeTotal = totalExpectedGoals <= 0 ? 0.1 : totalExpectedGoals;
 const baseCorners = 8.0;
 const totalCorners = baseCorners + totalExpectedGoals * 1.65;

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

 if (goalDiff < 0.35) totalCards += 0.9;
 else if (goalDiff < 0.7) totalCards += 0.4;

 if (totalExpectedGoals < 2.2) totalCards += 0.5;
 else if (totalExpectedGoals > 3.4) totalCards -= 0.2;

 return {
 total: Number(totalCards.toFixed(2))
 };
 }

 const { data: settingsRow, error: settingsError } = await supabase
 .from("model_settings")
 .select("*")
 .eq("is_active", true)
 .order("updated_at", { ascending: false })
 .limit(1)
 .maybeSingle();

 if (settingsError) throw settingsError;
 if (!settingsRow) throw new Error("Nincs aktív model_settings sor.");

 function predictMatch(match, homeForm, awayForm, settings) {
 const homeAttackRaw = Number(homeForm.avg_goals_for_home ?? homeForm.avg_goals_for ?? 1.2);
 const homeDefenseRaw = Number(homeForm.avg_goals_against_home ?? homeForm.avg_goals_against ?? 1.2);

 const awayAttackRaw = Number(awayForm.avg_goals_for_away ?? awayForm.avg_goals_for ?? 1.0);
 const awayDefenseRaw = Number(awayForm.avg_goals_against_away ?? awayForm.avg_goals_against ?? 1.0);

 const homeWinRate = softCapRate(homeForm.home_win_rate);
 const awayWinRate = softCapRate(awayForm.away_win_rate);

 const homeLeagueStrength = Number(homeForm.source_league_strength ?? 0.90);
 const awayLeagueStrength = Number(awayForm.source_league_strength ?? 0.90);

 const homeAttack = regressTowardMean(homeAttackRaw, 1.70, 0.38) * homeLeagueStrength;
 const awayAttack = regressTowardMean(awayAttackRaw, 1.45, 0.38) * awayLeagueStrength;

 const homeDefense = regressTowardMean(homeDefenseRaw, 1.10, 0.32) / homeLeagueStrength;
 const awayDefense = regressTowardMean(awayDefenseRaw, 1.10, 0.32) / awayLeagueStrength;

 const homeStrengthBoost = (homeWinRate - awayWinRate) * 0.045;
const leagueBalanceBoost = (homeLeagueStrength - awayLeagueStrength) * 0.06;
const homeAdvantage = Number(settings.home_advantage || 0.05) * 0.7;

let expectedHomeGoals =
 (homeAttack * Number(settings.home_attack_weight || 0.52)) +
 (awayDefense * Number(settings.away_defense_weight || 0.48)) +
 homeAdvantage +
 homeStrengthBoost +
 leagueBalanceBoost;

let expectedAwayGoals =
 (awayAttack * Number(settings.away_attack_weight || 0.52)) +
 (homeDefense * Number(settings.home_defense_weight || 0.48)) -
 (homeStrengthBoost * 0.08) -
 (leagueBalanceBoost * 0.12);

// Ha két erős csapat játszik, ne engedjünk nagy mesterséges eltérést
const bothStrong =
 homeLeagueStrength >= 0.93 &&
 awayLeagueStrength >= 0.93 &&
 awayAttackRaw >= 1.45 &&
 homeAttackRaw >= 1.45;

if (bothStrong) {
 const diff = expectedHomeGoals - expectedAwayGoals;
 if (Math.abs(diff) > 0.18) {
 const correctedDiff = diff * 0.38;
 const avg = (expectedHomeGoals + expectedAwayGoals) / 2;
 expectedHomeGoals = avg + correctedDiff / 2;
 expectedAwayGoals = avg - correctedDiff / 2;
 }
}

// Ha a két csapat közel van egymáshoz, húzzuk közelebb döntetlenesebb zónába
const teamGap =
 Math.abs(homeAttackRaw - awayAttackRaw) +
 Math.abs(homeDefenseRaw - awayDefenseRaw);

if (teamGap < 0.45) {
 const avg = (expectedHomeGoals + expectedAwayGoals) / 2;
 expectedHomeGoals = (expectedHomeGoals * 0.35) + (avg * 0.65);
 expectedAwayGoals = (expectedAwayGoals * 0.35) + (avg * 0.65);
}
 expectedHomeGoals = clamp(Number(expectedHomeGoals.toFixed(2)), 0.45, 2.5);
 expectedAwayGoals = clamp(Number(expectedAwayGoals.toFixed(2)), 0.45, 2.4);

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
 if (
 over25 >= Number(settings.over25_threshold || 0.6) &&
 totalGoals >= Number(settings.min_total_goals_for_over || 2.6)
 ) {
 finalOver25Tip = "2,5 FELETT";
 }

 let finalBttsTip = "NEM";
 if (
 btts >= Number(settings.btts_threshold || 0.6) &&
 expectedHomeGoals >= Number(settings.min_team_goal_for_btts || 0.95) &&
 expectedAwayGoals >= Number(settings.min_team_goal_for_btts || 0.95)
 ) {
 finalBttsTip = "IGEN";
 }

 let predicted1x2Pick = "DRAW";
 if (homeWin > draw && homeWin > awayWin) {
 predicted1x2Pick = "HOME";
 } else if (awayWin > homeWin && awayWin > draw) {
 predicted1x2Pick = "AWAY";
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
 predicted_1x2_pick: predicted1x2Pick,
 predicted_corners_total: corners.total,
 predicted_cards_total: cards.total,
 final_over25_tip: finalOver25Tip,
 final_btts_tip: finalBttsTip,
 used_home_advantage: homeAdvantage,
 used_over25_threshold: Number(settings.over25_threshold || 0.6),
 used_btts_threshold: Number(settings.btts_threshold || 0.6),
 explanation: `A modell súlyozott forma, ligaerő és stabilizált topcsapat-korrekció alapján számol. A várható gólok: ${match.home_team_name} ${expectedHomeGoals.toFixed(
 2
 )}, ${match.away_team_name} ${expectedAwayGoals.toFixed(
 2
 )}. Enyhe fölényben van: ${strongerSide}.`
 };
 }

 function getActual1x2Result(match) {
 const homeGoals = match.full_time_home;
 const awayGoals = match.full_time_away;

 if (homeGoals == null || awayGoals == null) return null;

 if (homeGoals > awayGoals) return "HOME";
 if (awayGoals > homeGoals) return "AWAY";
 return "DRAW";
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

 if (!homeForm || !awayForm) continue;

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

 const actual1x2 = isFinished ? getActual1x2Result(match) : null;

 const prediction = predictMatch(match, homeForm, awayForm, settingsRow);

 if (existingPrediction && isLockedStatus) {
 const missing1X2 =
 existingPrediction.predicted_home_win_probability == null ||
 existingPrediction.predicted_draw_probability == null ||
 existingPrediction.predicted_away_win_probability == null ||
 existingPrediction.predicted_1x2_pick == null;

 if (missing1X2) {
 rowsToPatch1X2.push({
 match_id: match.match_id,
 predicted_home_win_probability: prediction.predicted_home_win_probability,
 predicted_draw_probability: prediction.predicted_draw_probability,
 predicted_away_win_probability: prediction.predicted_away_win_probability,
 predicted_1x2_pick: prediction.predicted_1x2_pick,
 final_over25_tip: prediction.final_over25_tip,
 final_btts_tip: prediction.final_btts_tip,
 used_home_advantage: prediction.used_home_advantage,
 used_over25_threshold: prediction.used_over25_threshold,
 used_btts_threshold: prediction.used_btts_threshold,
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
 winner_hit:
 isFinished && existingPrediction.predicted_1x2_pick
 ? existingPrediction.predicted_1x2_pick === actual1x2
 : null,
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
 predicted_1x2_pick: prediction.predicted_1x2_pick,
 predicted_corners_total: prediction.predicted_corners_total,
 predicted_cards_total: prediction.predicted_cards_total,
 final_over25_tip: prediction.final_over25_tip,
 final_btts_tip: prediction.final_btts_tip,
 used_home_advantage: prediction.used_home_advantage,
 used_over25_threshold: prediction.used_over25_threshold,
 used_btts_threshold: prediction.used_btts_threshold,
 explanation: prediction.explanation,

 actual_home_goals: isFinished ? match.full_time_home : null,
 actual_away_goals: isFinished ? match.full_time_away : null,
 exact_hit: isFinished ? prediction.predicted_score === actualScore : null,
 over25_hit: isFinished
 ? (prediction.final_over25_tip === "2,5 FELETT") === (actualTotal > 2.5)
 : null,
 btts_hit: isFinished
 ? (prediction.final_btts_tip === "IGEN") === actualBtts
 : null,
 winner_hit: isFinished ? prediction.predicted_1x2_pick === actual1x2 : null,

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
 predicted_1x2_pick: row.predicted_1x2_pick,
 final_over25_tip: row.final_over25_tip,
 final_btts_tip: row.final_btts_tip,
 used_home_advantage: row.used_home_advantage,
 used_over25_threshold: row.used_over25_threshold,
 used_btts_threshold: row.used_btts_threshold,
 updated_at: row.updated_at
 })
 .eq("match_id", row.match_id);

 if (patchError) throw patchError;
 }

 for (const row of rowsToUpdateLocked) {
 const { data: existingRow, error: existingRowError } = await supabase
 .from("predictions_history")
 .select("predicted_score, final_over25_tip, final_btts_tip, predicted_1x2_pick")
 .eq("match_id", row.match_id)
 .maybeSingle();

 if (existingRowError) throw existingRowError;
 if (!existingRow) continue;

 const isFinished = (row.status || "").toUpperCase() === "FINISHED";

 let exact_hit = null;
 let over25_hit = null;
 let btts_hit = null;
 let winner_hit = null;

 if (isFinished) {
 const actualScore = `${row.actual_home_goals ?? 0}-${row.actual_away_goals ?? 0}`;
 const actualTotal = (row.actual_home_goals ?? 0) + (row.actual_away_goals ?? 0);
 const actualBtts =
 (row.actual_home_goals ?? 0) > 0 && (row.actual_away_goals ?? 0) > 0;

 let actual1x2 = "DRAW";
 if ((row.actual_home_goals ?? 0) > (row.actual_away_goals ?? 0)) {
 actual1x2 = "HOME";
 } else if ((row.actual_home_goals ?? 0) < (row.actual_away_goals ?? 0)) {
 actual1x2 = "AWAY";
 }

 exact_hit = existingRow.predicted_score === actualScore;
 over25_hit = (existingRow.final_over25_tip === "2,5 FELETT") === (actualTotal > 2.5);
 btts_hit = (existingRow.final_btts_tip === "IGEN") === actualBtts;
 winner_hit =
 existingRow.predicted_1x2_pick != null
 ? existingRow.predicted_1x2_pick === actual1x2
 : null;
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
 winner_hit,
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
 predicted_1x2_pick: row.predicted_1x2_pick,
 predicted_corners_total: row.predicted_corners_total,
 predicted_cards_total: row.predicted_cards_total,
 final_over25_tip: row.final_over25_tip,
 final_btts_tip: row.final_btts_tip,
 used_home_advantage: row.used_home_advantage,
 used_over25_threshold: row.used_over25_threshold,
 used_btts_threshold: row.used_btts_threshold,
 explanation: row.explanation,

 actual_home_goals: row.actual_home_goals,
 actual_away_goals: row.actual_away_goals,
 exact_hit: row.exact_hit,
 over25_hit: row.over25_hit,
 btts_hit: row.btts_hit,
 winner_hit: row.winner_hit,
 updated_at: row.updated_at
 })
 .eq("match_id", row.match_id);

 if (updateError) throw updateError;
 }

 return {
 statusCode: 200,
 headers: { "content-type": "application/json" },
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
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 error: error.message || "Ismeretlen hiba"
 })
 };
 }
};