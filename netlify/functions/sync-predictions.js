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

 function getSeasonStartYearUtc() {
 const now = new Date();
 const year = now.getUTCFullYear();
 const month = now.getUTCMonth() + 1;

 return month >= 7 ? year : year - 1;
}

const matchDay = getTodayUtcDate();
const season = getSeasonStartYearUtc();

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

 function safeFormArray(value) {
 return Array.isArray(value) ? value.slice(0, 5) : [];
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

 const meanRegression = Number(settings.mean_regression_strength || 0.35);
 const formBoost = Number(settings.form_boost_weight || 0.35);

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

 expectedHomeGoals += (homeLast10Attack - 1.3) * formBoost;
 expectedAwayGoals += (awayLast10Attack - 1.2) * formBoost;

 expectedHomeGoals += (awayLast10Defense - 1.2) * 0.25;
 expectedAwayGoals += (homeLast10Defense - 1.2) * 0.25;

 if ((homeOverTrend + awayOverTrend) / 2 > 65) {
  expectedHomeGoals += 0.2;
  expectedAwayGoals += 0.2;
 }

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

 const scoreCandidates = [];

 for (let h = 0; h <= 6; h += 1) {
  for (let a = 0; a <= 6; a += 1) {
   const probability =
    poisson(expectedHomeGoals, h) * poisson(expectedAwayGoals, a);

   let adjusted = probability;

   if (h === a) adjusted *= 0.93;

   scoreCandidates.push({
    home: h,
    away: a,
    score: `${h}-${a}`,
    total: h + a,
    btts: h > 0 && a > 0,
    probability,
    adjusted
   });

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

 function isScoreCompatible(candidate) {
  if (finalOver25Tip === "2,5 FELETT" && candidate.total < 3) return false;
  if (finalOver25Tip === "2,5 ALATT" && candidate.total >= 3) return false;

  if (finalBttsTip === "IGEN" && !candidate.btts) return false;
  if (finalBttsTip === "NEM" && candidate.btts) return false;

  return true;
 }

 const compatibleScore = scoreCandidates
  .filter(isScoreCompatible)
  .sort((a, b) => b.adjusted - a.adjusted)[0];

 if (compatibleScore) {
  bestScore = compatibleScore.score;
 }

 let predicted1x2Pick = "DRAW";
 if (homeWin > draw && homeWin > awayWin) predicted1x2Pick = "HOME";
 else if (awayWin > homeWin && awayWin > draw) predicted1x2Pick = "AWAY";

 const corners = estimateCorners(expectedHomeGoals, expectedAwayGoals);
 const cards = estimateCards(expectedHomeGoals, expectedAwayGoals);

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
  used_over25_threshold: 60,
  used_btts_threshold: 60,
  explanation: ""
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
 const candidates = [];

 function addCandidate({
  row,
  pickType,
  pickLabel,
  pickValue,
  confidence,
  marketGroup
 }) {
  candidates.push({
   match_id: row.match_id,
   competition_code: row.competition_code,
   home_team_name: row.home_team_name,
   away_team_name: row.away_team_name,
   pick_type: pickType,
   pick_label: pickLabel,
   pick_value: Number(pickValue.toFixed(2)),
   confidence: Number(confidence.toFixed(2)),
   market_group: marketGroup
  });
 }

 for (const row of rows) {
  const homeProb = Number(row.predicted_home_win_probability || 0);
  const drawProb = Number(row.predicted_draw_probability || 0);
  const awayProb = Number(row.predicted_away_win_probability || 0);
  const overProb = Number(row.predicted_over25_probability || 0);
  const bttsProb = Number(row.predicted_btts_probability || 0);

  const expectedHomeGoals = Number(row.predicted_home_goals || 0);
  const expectedAwayGoals = Number(row.predicted_away_goals || 0);
  const totalGoals = expectedHomeGoals + expectedAwayGoals;

  const best1x2 = Math.max(homeProb, drawProb, awayProb);
  const secondBest1x2 = [homeProb, drawProb, awayProb]
   .sort((a, b) => b - a)[1];

  const gap1x2 = best1x2 - secondBest1x2;

  // 1X2: ne csak nyers százalékot nézzen, hanem azt is, mennyire válik el a második opciótól.
  if (homeProb === best1x2 && homeProb >= 47 && gap1x2 >= 6) {
   addCandidate({
    row,
    pickType: "HOME_WIN",
    pickLabel: "Hazai győzelem",
    pickValue: homeProb,
    confidence: homeProb + gap1x2 * 0.7,
    marketGroup: "1X2"
   });
  }

  if (awayProb === best1x2 && awayProb >= 47 && gap1x2 >= 6) {
   addCandidate({
    row,
    pickType: "AWAY_WIN",
    pickLabel: "Vendég győzelem",
    pickValue: awayProb,
    confidence: awayProb + gap1x2 * 0.7,
    marketGroup: "1X2"
   });
  }

  // Döntetlen ritkán megy 40 fölé, ezért itt alacsonyabb küszöb kell.
  if (drawProb === best1x2 && drawProb >= 34 && gap1x2 >= 2) {
   addCandidate({
    row,
    pickType: "DRAW",
    pickLabel: "Döntetlen",
    pickValue: drawProb,
    confidence: drawProb + gap1x2 * 0.6,
    marketGroup: "1X2"
   });
  }

  // Over 2.5: picit lazább, de kell hozzá várható gól is.
  if (overProb >= 57 && totalGoals >= 2.5) {
   addCandidate({
    row,
    pickType: "OVER25",
    pickLabel: "Over 2.5",
    pickValue: overProb,
    confidence: overProb + Math.max(0, totalGoals - 2.5) * 8,
    marketGroup: "GOALS"
   });
  }

  // BTTS: ne legyen túl szigorú, de mindkét csapat várható gólja legyen értelmezhető.
  if (
   bttsProb >= 56 &&
   row.final_btts_tip === "IGEN" &&
   expectedHomeGoals >= 0.9 &&
   expectedAwayGoals >= 0.9
  ) {
   addCandidate({
    row,
    pickType: "BTTS_YES",
    pickLabel: "Mindkét csapat gól",
    pickValue: bttsProb,
    confidence:
     bttsProb +
     Math.min(expectedHomeGoals, expectedAwayGoals) * 4,
    marketGroup: "BTTS"
   });
  }
 }

 const sortedCandidates = candidates.sort((a, b) => b.confidence - a.confidence);

 const finalPicks = [];
 const usedExactPick = new Set();
 const picksPerMatch = new Map();

 for (const pick of sortedCandidates) {
  const exactKey = `${pick.match_id}_${pick.pick_type}`;
  if (usedExactPick.has(exactKey)) continue;

  const currentMatchPickCount = picksPerMatch.get(pick.match_id) || 0;

  // Egy meccsből maximum 2 tipp, hogy ne egy meccs vigye el az egész szelvényt.
  if (currentMatchPickCount >= 2) continue;

  // Ha már van 4 pick, az ötödik csak erősebb legyen.
  if (finalPicks.length >= 4 && pick.confidence < 58) continue;

  finalPicks.push(pick);
  usedExactPick.add(exactKey);
  picksPerMatch.set(pick.match_id, currentMatchPickCount + 1);

  if (finalPicks.length >= 5) break;
 }

 // Ha túl kevés lenne, engedünk még egy kicsit a küszöbön, de csak vállalható tippeket.
 if (finalPicks.length < 3) {
  for (const pick of sortedCandidates) {
   const exactKey = `${pick.match_id}_${pick.pick_type}`;
   if (usedExactPick.has(exactKey)) continue;

   const currentMatchPickCount = picksPerMatch.get(pick.match_id) || 0;
   if (currentMatchPickCount >= 2) continue;
   if (pick.confidence < 53) continue;

   finalPicks.push(pick);
   usedExactPick.add(exactKey);
   picksPerMatch.set(pick.match_id, currentMatchPickCount + 1);

   if (finalPicks.length >= 3) break;
  }
 }

 if (finalPicks.length < 2) {
  return {
   created: false,
   reason: "Nincs elég vállalható tipp a mai napra",
   candidate_count: candidates.length
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

 return {
  created: true,
  already_exists: false,
  ticket_id: ticketInsert.id,
  saved_picks: finalPicks.length,
  candidate_count: candidates.length
 };
}

 async function refreshAiTicketResults() {
 const { data: todayTicket, error: todayTicketError } = await supabase
  .from("ai_tickets")
  .select("*")
  .eq("ticket_day", matchDay)
  .maybeSingle();

 if (todayTicketError) throw todayTicketError;
 if (!todayTicket) return;

 const { data: picks, error: picksError } = await supabase
  .from("ai_ticket_picks")
  .select("*")
  .eq("ticket_id", todayTicket.id);

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

 const { data: ticketPicks, error: ticketPicksError } = await supabase
  .from("ai_ticket_picks")
  .select("*")
  .eq("ticket_id", todayTicket.id);

 if (ticketPicksError) throw ticketPicksError;
 if (!ticketPicks || ticketPicks.length === 0) return;

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
  .eq("id", todayTicket.id);

 if (updateTicketError) throw updateTicketError;
}

const { data: matches, error: matchesError } = await supabase
 .from("matches")
 .select("*")
 .gte("match_date", `${matchDay}T00:00:00`)
 .lte("match_date", `${matchDay}T23:59:59`)
 .order("match_date", { ascending: true });

if (matchesError) throw matchesError;

const { data: formRows, error: formError } = await supabase
 .from("team_form_cache")
 .select("*")
 .eq("season", season);

 if (formError) throw formError;

const { data: existingPredictions, error: existingPredictionsError } = await supabase
 .from("predictions_history")
 .select("*")
 .gte("match_date", `${matchDay}T00:00:00`)
 .lte("match_date", `${matchDay}T23:59:59`);

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

 const homeLast5Form = safeFormArray(homeForm.last_5_form);
 const awayLast5Form = safeFormArray(awayForm.last_5_form);

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
 home_form: homeLast5Form,
 away_form: awayLast5Form,
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

 home_form: homeLast5Form,
 away_form: awayLast5Form,

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
 home_form: row.home_form,
 away_form: row.away_form,
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

 home_form: row.home_form,
 away_form: row.away_form,

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