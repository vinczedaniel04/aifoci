const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
 try {
  const adminToken = process.env.ADMIN_TOKEN;
  const requestToken =
   event.headers["x-admin-token"] ||
   event.headers["X-Admin-Token"] ||
   "";

  if (!adminToken) {
   return {
    statusCode: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Hiányzó ADMIN_TOKEN env változó."
    })
   };
  }

  if (requestToken !== adminToken) {
   return {
    statusCode: 401,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Nincs jogosultság."
    })
   };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
   return {
    statusCode: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Hiányzó SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY."
    })
   };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: settingsRow, error: settingsError } = await supabase
   .from("model_settings")
   .select("*")
   .eq("is_active", true)
   .order("updated_at", { ascending: false })
   .limit(1)
   .maybeSingle();

  if (settingsError) throw settingsError;

  const { data: trainingLogs, error: logsError } = await supabase
   .from("model_training_logs")
   .select("*")
   .order("created_at", { ascending: false })
   .limit(10);

  if (logsError) throw logsError;

  const { count: predictionsCount, error: predictionsCountError } = await supabase
   .from("predictions_history")
   .select("*", { count: "exact", head: true });

  if (predictionsCountError) throw predictionsCountError;

  const { count: finishedCount, error: finishedCountError } = await supabase
   .from("predictions_history")
   .select("*", { count: "exact", head: true })
   .eq("status", "FINISHED")
   .not("actual_home_goals", "is", null)
   .not("actual_away_goals", "is", null);

  if (finishedCountError) throw finishedCountError;

  const today = new Date().toISOString().slice(0, 10);

  const { data: todayPredictions, error: todayPredictionsError } = await supabase
   .from("predictions_history")
   .select("match_id,status,final_over25_tip,final_btts_tip,predicted_1x2_pick")
   .gte("match_date", `${today}T00:00:00`)
   .lte("match_date", `${today}T23:59:59`);

  if (todayPredictionsError) throw todayPredictionsError;

  const { data: todayTicket, error: todayTicketError } = await supabase
   .from("ai_tickets")
   .select("*")
   .eq("ticket_day", today)
   .maybeSingle();

  if (todayTicketError) throw todayTicketError;

  let todayTicketPicks = [];

  if (todayTicket) {
   const { data: picks, error: picksError } = await supabase
    .from("ai_ticket_picks")
    .select("*")
    .eq("ticket_id", todayTicket.id)
    .order("pick_value", { ascending: false });

   if (picksError) throw picksError;
   todayTicketPicks = picks || [];
  }

  return {
   statusCode: 200,
   headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
   },
   body: JSON.stringify({
    ok: true,
    today,
    model_settings: settingsRow,
    training_logs: trainingLogs || [],
    database_stats: {
     predictions_total: predictionsCount || 0,
     finished_predictions: finishedCount || 0,
     today_predictions: todayPredictions?.length || 0
    },
    today_ticket: todayTicket,
    today_ticket_picks: todayTicketPicks
   })
  };
 } catch (error) {
  return {
   statusCode: 500,
   headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
   },
   body: JSON.stringify({
    error: error.message || "Ismeretlen hiba"
   })
  };
 }
};