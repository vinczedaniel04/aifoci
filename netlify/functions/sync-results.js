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

   return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    "0"
   )}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }

  function getActual1x2Result(homeGoals, awayGoals) {
   if (homeGoals == null || awayGoals == null) return null;

   const home = Number(homeGoals);
   const away = Number(awayGoals);

   if (Number.isNaN(home) || Number.isNaN(away)) return null;

   if (home > away) return "HOME";
   if (away > home) return "AWAY";
   return "DRAW";
  }

  const today = getTodayUtcDate();
  const startOfDay = `${today}T00:00:00.000Z`;
  const endOfDay = `${today}T23:59:59.999Z`;

  const { data: matches, error: matchesError } = await supabase
   .from("matches")
   .select("*")
   .gte("match_date", startOfDay)
   .lte("match_date", endOfDay);

  if (matchesError) throw matchesError;

  const { data: predictions, error: predictionsError } = await supabase
   .from("predictions_history")
   .select(
    "match_id,predicted_score,final_over25_tip,final_btts_tip,predicted_1x2_pick"
   )
   .gte("match_date", startOfDay)
   .lte("match_date", endOfDay);

  if (predictionsError) throw predictionsError;

  const predictionMap = new Map();

  for (const prediction of predictions || []) {
   predictionMap.set(prediction.match_id, prediction);
  }

  let updated = 0;
  let skipped = 0;

  for (const match of matches || []) {
   const prediction = predictionMap.get(match.match_id);

   if (!prediction) {
    skipped += 1;
    continue;
   }

   const status = (match.status || "").toUpperCase();
   const isFinished = status === "FINISHED";

   const actualHomeGoals = isFinished ? match.full_time_home : null;
   const actualAwayGoals = isFinished ? match.full_time_away : null;

   let exact_hit = null;
   let over25_hit = null;
   let btts_hit = null;
   let winner_hit = null;

   if (isFinished) {
    const home = Number(match.full_time_home);
    const away = Number(match.full_time_away);

    if (!Number.isNaN(home) && !Number.isNaN(away)) {
     const actualScore = `${home}-${away}`;
     const actualTotal = home + away;
     const actualBtts = home > 0 && away > 0;
     const actual1x2 = getActual1x2Result(home, away);

     exact_hit = prediction.predicted_score === actualScore;
     over25_hit =
      (prediction.final_over25_tip === "2,5 FELETT") === (actualTotal > 2.5);
     btts_hit = (prediction.final_btts_tip === "IGEN") === actualBtts;
     winner_hit =
      prediction.predicted_1x2_pick != null
       ? prediction.predicted_1x2_pick === actual1x2
       : null;
    }
   }

   const { error: updateError } = await supabase
    .from("predictions_history")
    .update({
     status: match.status,
     live_home: match.live_home ?? null,
     live_away: match.live_away ?? null,
     minute: match.minute ?? null,
     actual_home_goals: actualHomeGoals,
     actual_away_goals: actualAwayGoals,
     exact_hit,
     over25_hit,
     btts_hit,
     winner_hit,
     updated_at: new Date().toISOString()
    })
    .eq("match_id", match.match_id);

   if (updateError) throw updateError;

   updated += 1;
  }

  return {
   statusCode: 200,
   headers: { "content-type": "application/json" },
   body: JSON.stringify({
    ok: true,
    updated,
    skipped,
    match_day: today
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