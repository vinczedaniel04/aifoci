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

 // LAST10 FORM
 const homeLast10Attack = Number(homeForm.last10_avg_goals_for ?? 1.3);
 const awayLast10Attack = Number(awayForm.last10_avg_goals_for ?? 1.2);

 const homeLast10Defense = Number(homeForm.last10_avg_goals_against ?? 1.2);
 const awayLast10Defense = Number(awayForm.last10_avg_goals_against ?? 1.2);

 const homeOverTrend = Number(homeForm.last10_over25_rate ?? 50);
 const awayOverTrend = Number(awayForm.last10_over25_rate ?? 50);

 const homeBttsTrend = Number(homeForm.last10_btts_rate ?? 50);
 const awayBttsTrend = Number(awayForm.last10_btts_rate ?? 50);

 const homeWinRate = softCapRate(homeForm.home_win_rate);
 const awayWinRate = softCapRate(awayForm.away_win_rate);

 const homeLeagueStrength = Number(homeForm.source_league_strength ?? 0.90);
 const awayLeagueStrength = Number(awayForm.source_league_strength ?? 0.90);

 // ÚJ: Dinamikus beállítások beolvasása az adatbázisból (vagy alapértelmezett érték)
 const meanRegression = Number(settings.mean_regression_strength || 0.35);
 const formBoost = Number(settings.form_boost_weight || 0.35);

 // Itt már a dinamikus meanRegression-t használjuk
 const homeAttack = regressTowardMean(homeAttackRaw, 1.70, meanRegression) * homeLeagueStrength;
 const awayAttack = regressTowardMean(awayAttackRaw, 1.45, meanRegression) * awayLeagueStrength;

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

 // FORM BOOST - Itt már a dinamikus formBoost változót használjuk
 expectedHomeGoals += (homeLast10Attack - 1.3) * formBoost;
 expectedAwayGoals += (awayLast10Attack - 1.2) * formBoost;

 expectedHomeGoals += (awayLast10Defense - 1.2) * 0.25;
 expectedAwayGoals += (homeLast10Defense - 1.2) * 0.25;

 // OVER TREND BOOST
 if ((homeOverTrend + awayOverTrend) / 2 > 65) {
 expectedHomeGoals += 0.2;
 expectedAwayGoals += 0.2;
 }

 // BTTS TREND BOOST
 if ((homeBttsTrend + awayBttsTrend) / 2 > 60) {
 expectedHomeGoals += 0.15;
 expectedAwayGoals += 0.15;
 }

 const bothStrong =
 homeLeagueStrength >= 0.93 &&
 awayLeagueStrength >= 0.93 &&
 awayAttackRaw >= 1.45 &&
 homeAttackRaw >= 1.45;

 if (bothStrong) {
 const diff = expectedHomeGoals - expectedAwayGoals;
 if (Math.abs(diff) > 0.18) {
 const correctedDiff = diff * 0.58;
 const avg = (expectedHomeGoals + expectedAwayGoals) / 2;
 expectedHomeGoals = avg + correctedDiff / 2;
 expectedAwayGoals = avg - correctedDiff / 2;
 }
 }

 const teamGap =
 Math.abs(homeAttackRaw - awayAttackRaw) +
 Math.abs(homeDefenseRaw - awayDefenseRaw);

 if (teamGap < 0.45) {
 const avg = (expectedHomeGoals + expectedAwayGoals) / 2;
 expectedHomeGoals = (expectedHomeGoals * 0.6) + (avg * 0.4);
 expectedAwayGoals = (expectedAwayGoals * 0.6) + (avg * 0.4);
 }

 expectedHomeGoals = clamp(Number(expectedHomeGoals.toFixed(2)), 0.45, 2.7);
 expectedAwayGoals = clamp(Number(expectedAwayGoals.toFixed(2)), 0.45, 2.6);

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

 let adjusted = probability;

 if (h === a) adjusted *= 0.93; // draw nerf

 if (adjusted > bestProbability) {
 bestProbability = adjusted;
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

 const totalGoals = expectedHomeGoals + expectedAwayGoals;

 let finalOver25Tip = "2,5 ALATT";
 if (over25 >= 0.6 && totalGoals >= 2.6) {
 finalOver25Tip = "2,5 FELETT";
 }

 let finalBttsTip = "NEM";
 if (btts >= 0.6 && expectedHomeGoals >= 0.95 && expectedAwayGoals >= 0.95) {
 finalBttsTip = "IGEN";
 }

 let predicted1x2Pick = "DRAW";
 if (homeWin > draw && homeWin > awayWin) predicted1x2Pick = "HOME";
 else if (awayWin > homeWin && awayWin > draw) predicted1x2Pick = "AWAY";

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
 final_over25_tip: finalOver25Tip,
 final_btts_tip: finalBttsTip
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

 async function saveAiTicketIfMissing() {
 const { data: existingTicket, error: existingTicketError } = await supabase
 .from("ai_tickets")
 .select("id, ticket_day")
 .eq("ticket_day", matchDay)
 .maybeSingle();

 if (existingTicketError) throw existingTicketError;

 if (existingTicket) {
 return {
 created: false,
 already_exists: true,
 ticket_id: existingTicket.id
 };
 }

 const { data: todayPredictions, error: todayPredictionsError } = await supabase
 .from("predictions_history")
 .select("*")
 .gte("match_date", `${matchDay}T00:00:00`)
 .lte("match_date", `${matchDay}T23:59:59`)
 .order("match_date", { ascending: true });

 if (todayPredictionsError) throw todayPredictionsError;

 const rows = todayPredictions || [];
 const picks = [];

 for (const row of rows) {
 const homeProb = Number(row.predicted_home_win_probability || 0);
 const drawProb = Number(row.predicted_draw_probability || 0);
 const awayProb = Number(row.predicted_away_win_probability || 0);
 const overProb = Number(row.predicted_over25_probability || 0);
 const bttsProb = Number(row.predicted_btts_probability || 0);
 const totalGoals =
 Number(row.predicted_home_goals || 0) + Number(row.predicted_away_goals || 0);

 if (homeProb >= 55) {
 picks.push({
 match_id: row.match_id,
 competition_code: row.competition_code,
 home_team_name: row.home_team_name,
 away_team_name: row.away_team_name,
 pick_type: "HOME_WIN",
 pick_label: "Hazai győzelem",
 pick_value: homeProb
 });
 }

 if (awayProb >= 55) {
 picks.push({
 match_id: row.match_id,
 competition_code: row.competition_code,
 home_team_name: row.home_team_name,
 away_team_name: row.away_team_name,
 pick_type: "AWAY_WIN",
 pick_label: "Vendég győzelem",
 pick_value: awayProb
 });
 }

 if (drawProb >= 40) {
 picks.push({
 match_id: row.match_id,
 competition_code: row.competition_code,
 home_team_name: row.home_team_name,
 away_team_name: row.away_team_name,
 pick_type: "DRAW",
 pick_label: "Döntetlen",
 pick_value: drawProb
 });
 }

 if (overProb >= 62 && totalGoals >= 2.7) {
 picks.push({
 match_id: row.match_id,
 competition_code: row.competition_code,
 home_team_name: row.home_team_name,
 away_team_name: row.away_team_name,
 pick_type: "OVER25",
 pick_label: "Over 2.5",
 pick_value: overProb
 });
 }

 if (bttsProb >= 60 && row.final_btts_tip === "IGEN") {
 picks.push({
 match_id: row.match_id,
 competition_code: row.competition_code,
 home_team_name: row.home_team_name,
 away_team_name: row.away_team_name,
 pick_type: "BTTS_YES",
 pick_label: "Mindkét csapat gól",
 pick_value: bttsProb
 });
 }
 }

const deduped = [];
 const seen = new Set();

 for (const pick of picks.sort((a, b) => b.pick_value - a.pick_value)) {
   const key = `${pick.match_id}_${pick.pick_type}`;
   if (seen.has(key)) continue;
   seen.add(key);
   deduped.push(pick);
 }

 // --- EZ A SOR HIÁNYZOTT: Itt hozzuk létre a finalPicks változót! ---
 const finalPicks = deduped.slice(0, 5);

 // --- JAVÍTOTT RETURN SZINTAXIS ---
 if (finalPicks.length < 2) {
   return {
     created: false,
     reason: "Nincs elég erős tipp a mai napra"
   };
 }

 const { data: ticketInsert, error: ticketInsertError } = await supabase
 .from("ai_tickets")
 .insert({
 ticket_day: matchDay,
 title: "Mai AI Tippmix",
 total_picks: finalPicks.length,
 hits: 0,
 is_full_hit: false
 })
 .select()
 .single();

 if (ticketInsertError) throw ticketInsertError;

 if (finalPicks.length > 0) {
 const pickRows = finalPicks.map((pick) => ({
 ticket_id: ticketInsert.id,
 match_id: pick.match_id,
 competition_code: pick.competition_code,
 home_team_name: pick.home_team_name,
 away_team_name: pick.away_team_name,
 pick_type: pick.pick_type,
 pick_label: pick.pick_label,
 pick_value: pick.pick_value
 }));

 const { error: picksInsertError } = await supabase
 .from("ai_ticket_picks")
 .insert(pickRows);

 if (picksInsertError) throw picksInsertError;
 }

 return {
 created: true,
 already_exists: false,
 ticket_id: ticketInsert.id,
 saved_picks: finalPicks.length
 };
 }

 async function refreshAiTicketResults() {
 const { data: picks, error: picksError } = await supabase
 .from("ai_ticket_picks")
 .select("*");

 if (picksError) throw picksError;

 for (const pick of picks || []) {
 const { data: match, error: matchError } = await supabase
 .from("matches")
 .select("*")
 .eq("match_id", pick.match_id)
 .maybeSingle();

 if (matchError) throw matchError;
 if (!match) continue;
 if ((match.status || "").toUpperCase() !== "FINISHED") continue;

 const home = Number(match.full_time_home);
 const away = Number(match.full_time_away);

 if (Number.isNaN(home) || Number.isNaN(away)) continue;

 let isHit = false;

 if (pick.pick_type === "HOME_WIN") {
 isHit = home > away;
 }

 if (pick.pick_type === "AWAY_WIN") {
 isHit = away > home;
 }

 if (pick.pick_type === "DRAW") {
 isHit = home === away;
 }

 if (pick.pick_type === "OVER25") {
 isHit = home + away >= 3;
 }

 if (pick.pick_type === "BTTS_YES") {
 isHit = home > 0 && away > 0;
 }

 const { error: updatePickError } = await supabase
 .from("ai_ticket_picks")
 .update({ is_hit: isHit })
 .eq("id", pick.id);

 if (updatePickError) throw updatePickError;
 }

 const { data: tickets, error: ticketsError } = await supabase
 .from("ai_tickets")
 .select("*");

 if (ticketsError) throw ticketsError;

 for (const ticket of tickets || []) {
 const { data: ticketPicks, error: ticketPicksError } = await supabase
 .from("ai_ticket_picks")
 .select("*")
 .eq("ticket_id", ticket.id);

 if (ticketPicksError) throw ticketPicksError;
 if (!ticketPicks || ticketPicks.length === 0) continue;

 const hits = ticketPicks.filter((p) => p.is_hit === true).length;
 const allFinished = ticketPicks.every((p) => p.is_hit !== null);
 const isFullHit = allFinished && hits === ticketPicks.length;

 const { error: updateTicketError } = await supabase
 .from("ai_tickets")
 .update({
 hits,
 is_full_hit: isFullHit,
 total_picks: ticketPicks.length
 })
 .eq("id", ticket.id);

 if (updateTicketError) throw updateTicketError;
 }
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
 final_over25_tip: prediction.final_over25Tip || prediction.final_over25_tip,
 final_btts_tip: prediction.finalBttsTip || prediction.final_btts_tip,
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

 const isFinishedLocked = (row.status || "").toUpperCase() === "FINISHED";

 let exact_hit = null;
 let over25_hit = null;
 let btts_hit = null;
 let winner_hit = null;

 if (isFinishedLocked) {
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

 const aiTicket = await saveAiTicketIfMissing();
 await refreshAiTicketResults();

 return {
 statusCode: 200,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 ok: true,
 inserted: rowsToInsert.length,
 updated_locked: rowsToUpdateLocked.length,
 updated_unlocked: rowsToUpdateUnlocked.length,
 patched_1x2_locked: rowsToPatch1X2.length,
 match_day: matchDay,
 ai_ticket: aiTicket
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