const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const supabase = createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE_KEY
 );

 function clamp(value, min, max) {
 return Math.max(min, Math.min(max, value));
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

 const { data: finishedRows, error: finishedError } = await supabase
 .from("predictions_history")
 .select(`
 match_id,
 competition_code,
 status,
 predicted_1x2_pick,
 final_over25_tip,
 final_btts_tip,
 predicted_home_win_probability,
 predicted_draw_probability,
 predicted_away_win_probability,
 actual_home_goals,
 actual_away_goals,
 winner_hit,
 over25_hit,
 btts_hit,
 match_date
 `)
 .eq("status", "FINISHED")
 .not("actual_home_goals", "is", null)
 .not("actual_away_goals", "is", null)
 .order("match_date", { ascending: false })
 .limit(150); // Ha stabil a DB, érdemes lehet később ezt .limit(400)-ra emelni

 if (finishedError) throw finishedError;

 const rows = finishedRows || [];

 if (rows.length < 5) {
 return {
 statusCode: 200,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 ok: true,
 message: "Még kevés lezárt meccs van a tanításhoz.",
 finished_matches: rows.length
 })
 };
 }

 let winnerCorrect = 0;
 let overCorrect = 0;
 let bttsCorrect = 0;

 let homePredCount = 0;
 let drawPredCount = 0;
 let awayPredCount = 0;

 let homePredCorrect = 0;
 let drawPredCorrect = 0;
 let awayPredCorrect = 0;

 let overPredCount = 0;
 let overPredWrong = 0;

 let bttsYesPredCount = 0;
 let bttsYesPredWrong = 0;

 let homeFavChecks = 0;
 let homeFavWrong = 0;

 const leagueStats = {};

 for (const row of rows) {
 const winnerHit = row.winner_hit === true;
 const overHit = row.over25_hit === true;
 const bttsHit = row.btts_hit === true;

 if (winnerHit) winnerCorrect += 1;
 if (overHit) overCorrect += 1;
 if (bttsHit) bttsCorrect += 1;

 const pick = row.predicted_1x2_pick || "DRAW";

 if (pick === "HOME") {
 homePredCount += 1;
 if (winnerHit) homePredCorrect += 1;
 } else if (pick === "DRAW") {
 drawPredCount += 1;
 if (winnerHit) drawPredCorrect += 1;
 } else if (pick === "AWAY") {
 awayPredCount += 1;
 if (winnerHit) awayPredCorrect += 1;
 }

 if (row.final_over25_tip === "2,5 FELETT") {
 overPredCount += 1;
 if (!overHit) overPredWrong += 1;
 }

 if (row.final_btts_tip === "IGEN") {
 bttsYesPredCount += 1;
 if (!bttsHit) bttsYesPredWrong += 1;
 }

 const homeProb = Number(row.predicted_home_win_probability || 0);
 if (homeProb >= 50) {
 homeFavChecks += 1;
 if (!winnerHit) homeFavWrong += 1;
 }

 const league = row.competition_code || "UNKNOWN";
 if (!leagueStats[league]) {
 leagueStats[league] = {
 total: 0,
 winner_correct: 0,
 over_correct: 0,
 btts_correct: 0
 };
 }

 leagueStats[league].total += 1;
 if (winnerHit) leagueStats[league].winner_correct += 1;
 if (overHit) leagueStats[league].over_correct += 1;
 if (bttsHit) leagueStats[league].btts_correct += 1;
 }

 const overallWinnerRate = winnerCorrect / rows.length;
 const overallOverRate = overCorrect / rows.length;
 const overallBttsRate = bttsCorrect / rows.length;

 const homePickRate = homePredCount ? homePredCorrect / homePredCount : 0;
 const drawPickRate = drawPredCount ? drawPredCorrect / drawPredCount : 0;
 const awayPickRate = awayPredCount ? awayPredCorrect / awayPredCount : 0;

 const overMissRate = overPredCount ? overPredWrong / overPredCount : 0;
 const bttsYesMissRate = bttsYesPredCount ? bttsYesPredWrong / bttsYesPredCount : 0;
 const homeFavMissRate = homeFavChecks ? homeFavWrong / homeFavChecks : 0;

 // ----- DINAMIKUS FINOMHANGOLÁS ÉS OVERFITTING VÉDELEM -----
 
 // Megcélzott (ideális) tévesztési arányok. 
 const TARGET_MISS_RATE_1X2 = 0.30; 
 const TARGET_MISS_RATE_OVER = 0.33;
 const TARGET_MISS_RATE_BTTS = 0.33;

 // Tanulási ráta (Learning Rate): A hiba hány százalékát korrigálja egy lépésben.
 const LEARNING_RATE = 0.05; 

 // EMA (Exponential Moving Average) Alpha: 80% marad a régi, 20% az új korrekció.
 const STABILITY_ALPHA = 0.80;

 let newHomeAdvantage = Number(settingsRow.home_advantage || 0.05);
 let newOverThreshold = Number(settingsRow.over25_threshold || 0.60);
 let newBttsThreshold = Number(settingsRow.btts_threshold || 0.60);
 let newMinTotalGoalsForOver = Number(settingsRow.min_total_goals_for_over || 2.60);
 let newMinTeamGoalForBtts = Number(settingsRow.min_team_goal_for_btts || 0.95);
 
 // Az új adatbázis mezők betöltése
 let newMeanRegression = Number(settingsRow.mean_regression_strength || 0.35);
 let newFormBoost = Number(settingsRow.form_boost_weight || 0.35);

 // --- 1. 1X2 ÉS HAZAI PÁLYA ELŐNYE ---
 if (homeFavChecks >= 10) {
     const error1x2 = homeFavMissRate - TARGET_MISS_RATE_1X2;
     const correction = error1x2 * LEARNING_RATE; 
     const calculatedAdvantage = newHomeAdvantage - correction;
     newHomeAdvantage = (newHomeAdvantage * STABILITY_ALPHA) + (calculatedAdvantage * (1 - STABILITY_ALPHA));
 } else if (drawPredCount >= 8 && drawPickRate < 0.22) {
     // Enyhe korrekció, ha nagyon ritkán találja el a döntetlent
     newHomeAdvantage += 0.002;
 }

 // --- 2. OVER 2.5 KÜSZÖBÉRTÉKEK ---
 if (overPredCount >= 10) {
     const errorOver = overMissRate - TARGET_MISS_RATE_OVER;
     const correction = errorOver * LEARNING_RATE;
     
     const calculatedThreshold = newOverThreshold + correction;
     const calculatedMinTotal = newMinTotalGoalsForOver + (correction * 2.5); // Arányos tolatás
     
     newOverThreshold = (newOverThreshold * STABILITY_ALPHA) + (calculatedThreshold * (1 - STABILITY_ALPHA));
     newMinTotalGoalsForOver = (newMinTotalGoalsForOver * STABILITY_ALPHA) + (calculatedMinTotal * (1 - STABILITY_ALPHA));
 }

 // --- 3. BTTS KÜSZÖBÉRTÉKEK ---
 if (bttsYesPredCount >= 10) {
     const errorBtts = bttsYesMissRate - TARGET_MISS_RATE_BTTS;
     const correction = errorBtts * LEARNING_RATE;
     
     const calculatedBttsThresh = newBttsThreshold + correction;
     const calculatedMinGoal = newMinTeamGoalForBtts + (correction * 1.5);
     
     newBttsThreshold = (newBttsThreshold * STABILITY_ALPHA) + (calculatedBttsThresh * (1 - STABILITY_ALPHA));
     newMinTeamGoalForBtts = (newMinTeamGoalForBtts * STABILITY_ALPHA) + (calculatedMinGoal * (1 - STABILITY_ALPHA));
 }

 // --- 4. FORM BOOST FINOMHANGOLÁSA ---
 // Ha a favoritok megbízhatóan nyernek (alacsony miss rate), lehet bízni a jó formában.
 if (homeFavChecks >= 10) {
     if (homeFavMissRate < 0.25) {
         newFormBoost = (newFormBoost * STABILITY_ALPHA) + ((newFormBoost + 0.02) * (1 - STABILITY_ALPHA));
     } else if (homeFavMissRate > 0.40) {
         // Ha sok a meglepetés, kevésbé hiszünk a csapatok pillanatnyi formájában (visszahúzzuk az átlag felé)
         newFormBoost = (newFormBoost * STABILITY_ALPHA) + ((newFormBoost - 0.02) * (1 - STABILITY_ALPHA));
         newMeanRegression = (newMeanRegression * STABILITY_ALPHA) + ((newMeanRegression + 0.02) * (1 - STABILITY_ALPHA));
     }
 }

 // Védelem: clamp függvény a szélsőséges értékek elkerülésére (nem engedjük kiakadni a modellt)
 newHomeAdvantage = clamp(Number(newHomeAdvantage.toFixed(4)), 0.00, 0.20);
 newOverThreshold = clamp(Number(newOverThreshold.toFixed(4)), 0.52, 0.72);
 newBttsThreshold = clamp(Number(newBttsThreshold.toFixed(4)), 0.52, 0.72);
 newMinTotalGoalsForOver = clamp(Number(newMinTotalGoalsForOver.toFixed(4)), 2.30, 3.10);
 newMinTeamGoalForBtts = clamp(Number(newMinTeamGoalForBtts.toFixed(4)), 0.75, 1.20);
 newMeanRegression = clamp(Number(newMeanRegression.toFixed(4)), 0.20, 0.50);
 newFormBoost = clamp(Number(newFormBoost.toFixed(4)), 0.15, 0.60);

 const { error: updateError } = await supabase
 .from("model_settings")
 .update({
     home_advantage: newHomeAdvantage,
     over25_threshold: newOverThreshold,
     btts_threshold: newBttsThreshold,
     min_total_goals_for_over: newMinTotalGoalsForOver,
     min_team_goal_for_btts: newMinTeamGoalForBtts,
     mean_regression_strength: newMeanRegression,
     form_boost_weight: newFormBoost,
     updated_at: new Date().toISOString()
 })
 .eq("id", settingsRow.id);

 if (updateError) throw updateError;

 const leagueBreakdown = Object.entries(leagueStats)
 .map(([code, stat]) => ({
 competition_code: code,
 total: stat.total,
 winner_rate: Number(((stat.winner_correct / stat.total) * 100).toFixed(2)),
 over_rate: Number(((stat.over_correct / stat.total) * 100).toFixed(2)),
 btts_rate: Number(((stat.btts_correct / stat.total) * 100).toFixed(2))
 }))
 .sort((a, b) => b.total - a.total);

 return {
 statusCode: 200,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 ok: true,
 finished_matches: rows.length,
 overall: {
 winner_rate: Number((overallWinnerRate * 100).toFixed(2)),
 over_rate: Number((overallOverRate * 100).toFixed(2)),
 btts_rate: Number((overallBttsRate * 100).toFixed(2))
 },
 pick_breakdown: {
 home_pick_count: homePredCount,
 home_pick_rate: Number((homePickRate * 100).toFixed(2)),
 draw_pick_count: drawPredCount,
 draw_pick_rate: Number((drawPickRate * 100).toFixed(2)),
 away_pick_count: awayPredCount,
 away_pick_rate: Number((awayPickRate * 100).toFixed(2))
 },
 miss_breakdown: {
 home_favorite_miss_rate: Number((homeFavMissRate * 100).toFixed(2)),
 over_yes_miss_rate: Number((overMissRate * 100).toFixed(2)),
 btts_yes_miss_rate: Number((bttsYesMissRate * 100).toFixed(2))
 },
 updated_settings: {
 home_advantage: newHomeAdvantage,
 over25_threshold: newOverThreshold,
 btts_threshold: newBttsThreshold,
 min_total_goals_for_over: newMinTotalGoalsForOver,
 min_team_goal_for_btts: newMinTeamGoalForBtts,
 mean_regression_strength: newMeanRegression,
 form_boost_weight: newFormBoost
 },
 league_breakdown: leagueBreakdown
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