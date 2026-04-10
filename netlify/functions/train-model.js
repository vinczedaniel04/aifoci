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
 .select("*")
 .eq("status", "FINISHED")
 .not("actual_home_goals", "is", null)
 .not("actual_away_goals", "is", null)
 .order("match_date", { ascending: false })
 .limit(100);

 if (finishedError) throw finishedError;

 const rows = finishedRows || [];

 if (rows.length < 20) {
 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 message: "Még kevés lezárt meccs van a tanításhoz.",
 finished_matches: rows.length
 })
 };
 }

 let wrongOver = 0;
 let wrongBtts = 0;
 let tooManyHomeFavs = 0;
 let homeFavChecks = 0;

 for (const row of rows) {
 const actualTotal = (row.actual_home_goals ?? 0) + (row.actual_away_goals ?? 0);
 const actualOver = actualTotal > 2.5;
 const actualBtts =
 (row.actual_home_goals ?? 0) > 0 && (row.actual_away_goals ?? 0) > 0;

 const predictedOver = row.final_over25_tip === "2,5 FELETT";
 const predictedBtts = row.final_btts_tip === "IGEN";

 if (predictedOver !== actualOver) wrongOver += 1;
 if (predictedBtts !== actualBtts) wrongBtts += 1;

 const homeProb = Number(row.predicted_home_win_probability || 0);

 if (homeProb >= 50) {
 homeFavChecks += 1;
 if ((row.actual_home_goals ?? 0) <= (row.actual_away_goals ?? 0)) {
 tooManyHomeFavs += 1;
 }
 }
 }

 const overErrorRate = wrongOver / rows.length;
 const bttsErrorRate = wrongBtts / rows.length;
 const homeFavFailRate = homeFavChecks > 0 ? tooManyHomeFavs / homeFavChecks : 0;

 let newHomeAdvantage = Number(settingsRow.home_advantage || 0.05);
 let newOverThreshold = Number(settingsRow.over25_threshold || 0.60);
 let newBttsThreshold = Number(settingsRow.btts_threshold || 0.60);
 let newMinTotalGoalsForOver = Number(settingsRow.min_total_goals_for_over || 2.60);
 let newMinTeamGoalForBtts = Number(settingsRow.min_team_goal_for_btts || 0.95);

 if (homeFavFailRate > 0.45) newHomeAdvantage -= 0.01;
 else if (homeFavFailRate < 0.25 && homeFavChecks >= 10) newHomeAdvantage += 0.01;

 if (overErrorRate > 0.42) {
 newOverThreshold += 0.01;
 newMinTotalGoalsForOver += 0.03;
 } else if (overErrorRate < 0.30) {
 newOverThreshold -= 0.01;
 newMinTotalGoalsForOver -= 0.03;
 }

 if (bttsErrorRate > 0.42) {
 newBttsThreshold += 0.01;
 newMinTeamGoalForBtts += 0.02;
 } else if (bttsErrorRate < 0.30) {
 newBttsThreshold -= 0.01;
 newMinTeamGoalForBtts -= 0.02;
 }

 newHomeAdvantage = clamp(Number(newHomeAdvantage.toFixed(4)), 0.00, 0.20);
 newOverThreshold = clamp(Number(newOverThreshold.toFixed(4)), 0.52, 0.70);
 newBttsThreshold = clamp(Number(newBttsThreshold.toFixed(4)), 0.52, 0.70);
 newMinTotalGoalsForOver = clamp(Number(newMinTotalGoalsForOver.toFixed(4)), 2.30, 3.00);
 newMinTeamGoalForBtts = clamp(Number(newMinTeamGoalForBtts.toFixed(4)), 0.75, 1.20);

 const { error: updateError } = await supabase
 .from("model_settings")
 .update({
 home_advantage: newHomeAdvantage,
 over25_threshold: newOverThreshold,
 btts_threshold: newBttsThreshold,
 min_total_goals_for_over: newMinTotalGoalsForOver,
 min_team_goal_for_btts: newMinTeamGoalForBtts,
 updated_at: new Date().toISOString()
 })
 .eq("id", settingsRow.id);

 if (updateError) throw updateError;

 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 finished_matches: rows.length,
 over_error_rate: Number((overErrorRate * 100).toFixed(2)),
 btts_error_rate: Number((bttsErrorRate * 100).toFixed(2)),
 home_fav_fail_rate: Number((homeFavFailRate * 100).toFixed(2)),
 updated_settings: {
 home_advantage: newHomeAdvantage,
 over25_threshold: newOverThreshold,
 btts_threshold: newBttsThreshold,
 min_total_goals_for_over: newMinTotalGoalsForOver,
 min_team_goal_for_btts: newMinTeamGoalForBtts
 }
 })
 };
 } catch (error) {
 return {
 statusCode: 500,
 body: JSON.stringify({
 error: error.message || "Ismeretlen hiba"
 })
 };
 }
};