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

  function pct(hit, total) {
   if (!total) return 0;
   return Number(((hit / total) * 100).toFixed(1));
  }

  function monthKeyFromDate(value) {
   const date = new Date(value);
   if (Number.isNaN(date.getTime())) return null;

   return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(monthKey) {
   const [year, month] = monthKey.split("-").map(Number);
   const date = new Date(Date.UTC(year, month - 1, 1));

   return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    timeZone: "UTC"
   }).format(date);
  }

  function getStartIsoForOldestMonth(monthKey) {
   const [year, month] = monthKey.split("-").map(Number);
   return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)).toISOString();
  }

  function getEndIsoForNextMonth() {
   const now = new Date();
   return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString();
  }

  function getMonthsFromOldestToNow(oldestMonthKey) {
   const [oldestYear, oldestMonthNumber] = oldestMonthKey.split("-").map(Number);
   const now = new Date();

   const months = [];
   let cursor = new Date(Date.UTC(oldestYear, oldestMonthNumber - 1, 1));
   const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

   while (cursor <= end) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    months.push(key);

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
   }

   return months.reverse();
  }

  const endIso = getEndIsoForNextMonth();

  const { data: firstPredictionRows, error: firstPredictionError } = await supabase
   .from("predictions_history")
   .select("match_date")
   .order("match_date", { ascending: true })
   .limit(1);

  if (firstPredictionError) throw firstPredictionError;

  const { data: firstTicketRows, error: firstTicketError } = await supabase
   .from("ai_tickets")
   .select("ticket_day")
   .order("ticket_day", { ascending: true })
   .limit(1);

  if (firstTicketError) throw firstTicketError;

  const firstPredictionDate = firstPredictionRows?.[0]?.match_date || null;
  const firstTicketDate = firstTicketRows?.[0]?.ticket_day || null;

  const possibleStartDates = [firstPredictionDate, firstTicketDate]
   .filter(Boolean)
   .map((value) => new Date(value))
   .filter((date) => !Number.isNaN(date.getTime()));

  if (!possibleStartDates.length) {
   return {
    statusCode: 200,
    headers: {
     "content-type": "application/json",
     "cache-control": "no-store"
    },
    body: JSON.stringify({
     ok: true,
     months: []
    })
   };
  }

  const oldestDateObject = new Date(
   Math.min(...possibleStartDates.map((date) => date.getTime()))
  );

  const oldestMonth = `${oldestDateObject.getUTCFullYear()}-${String(
   oldestDateObject.getUTCMonth() + 1
  ).padStart(2, "0")}`;

  const startIso = getStartIsoForOldestMonth(oldestMonth);

  const monthKeys = getMonthsFromOldestToNow(oldestMonth);

  const monthMap = new Map();

  for (const key of monthKeys) {
   monthMap.set(key, {
    month: key,
    label: monthLabel(key),
    prediction_rows: [],
    ticket_rows: [],
    pick_rows: [],
    daily_tickets: [],
    recent_predictions: []
   });
  }

  const { data: predictionRows, error: predictionError } = await supabase
   .from("predictions_history")
   .select(`
    match_id,
    match_date,
    competition_code,
    home_team_name,
    away_team_name,
    predicted_score,
    final_over25_tip,
    final_btts_tip,
    predicted_1x2_pick,
    actual_home_goals,
    actual_away_goals,
    exact_hit,
    winner_hit,
    over25_hit,
    btts_hit,
    status
   `)
   .gte("match_date", startIso)
   .lt("match_date", endIso)
   .eq("status", "FINISHED")
   .not("actual_home_goals", "is", null)
   .not("actual_away_goals", "is", null)
   .order("match_date", { ascending: false });

  if (predictionError) throw predictionError;

  for (const row of predictionRows || []) {
   const key = monthKeyFromDate(row.match_date);
   if (!key || !monthMap.has(key)) continue;

   monthMap.get(key).prediction_rows.push(row);
  }

  const oldestDate = `${oldestMonth}-01`;

  const { data: ticketRows, error: ticketsError } = await supabase
   .from("ai_tickets")
   .select("*")
   .gte("ticket_day", oldestDate)
   .order("ticket_day", { ascending: false });

  if (ticketsError) throw ticketsError;

  const ticketIds = (ticketRows || []).map((ticket) => ticket.id);
  let pickRows = [];

  if (ticketIds.length > 0) {
   const { data: picks, error: picksError } = await supabase
    .from("ai_ticket_picks")
    .select("*")
    .in("ticket_id", ticketIds);

   if (picksError) throw picksError;

   pickRows = picks || [];
  }

  const picksByTicketId = new Map();

  for (const pick of pickRows) {
   if (!picksByTicketId.has(pick.ticket_id)) {
    picksByTicketId.set(pick.ticket_id, []);
   }

   picksByTicketId.get(pick.ticket_id).push(pick);
  }

  for (const ticket of ticketRows || []) {
   const key = String(ticket.ticket_day || "").slice(0, 7);
   if (!monthMap.has(key)) continue;

   const picks = picksByTicketId.get(ticket.id) || [];

   monthMap.get(key).ticket_rows.push(ticket);
   monthMap.get(key).daily_tickets.push({
    id: ticket.id,
    ticket_day: ticket.ticket_day,
    title: ticket.title,
    total_picks: picks.length,
    settled_picks: picks.filter((pick) => pick.is_hit !== null).length,
    hits: picks.filter((pick) => pick.is_hit === true).length,
    is_full_hit: ticket.is_full_hit === true,
    hit_rate: pct(
     picks.filter((pick) => pick.is_hit === true).length,
     picks.filter((pick) => pick.is_hit !== null).length
    ),
    picks: picks
     .map((pick) => ({
      home_team_name: pick.home_team_name,
      away_team_name: pick.away_team_name,
      pick_label: pick.pick_label,
      pick_value: pick.pick_value,
      is_hit: pick.is_hit
     }))
     .sort((a, b) => Number(b.pick_value || 0) - Number(a.pick_value || 0))
   });
  }

  const months = Array.from(monthMap.values()).map((monthData) => {
   const predictions = monthData.prediction_rows;
   const tickets = monthData.ticket_rows;
   const allPicks = monthData.daily_tickets.flatMap((ticket) => ticket.picks || []);
   const settledPicks = allPicks.filter((pick) => pick.is_hit !== null);
   const hitPicks = allPicks.filter((pick) => pick.is_hit === true);

   const exactHits = predictions.filter((x) => x.exact_hit === true).length;
   const winnerHits = predictions.filter((x) => x.winner_hit === true).length;
   const overHits = predictions.filter((x) => x.over25_hit === true).length;
   const bttsHits = predictions.filter((x) => x.btts_hit === true).length;

   return {
    month: monthData.month,
    label: monthData.label,
    prediction_stats: {
     total: predictions.length,
     exact_hits: exactHits,
     winner_hits: winnerHits,
     over25_hits: overHits,
     btts_hits: bttsHits,
     exact_rate: pct(exactHits, predictions.length),
     winner_rate: pct(winnerHits, predictions.length),
     over25_rate: pct(overHits, predictions.length),
     btts_rate: pct(bttsHits, predictions.length)
    },
    ticket_stats: {
     ticket_days: tickets.length,
     total_picks: allPicks.length,
     settled_picks: settledPicks.length,
     hit_picks: hitPicks.length,
     full_hit_tickets: tickets.filter((ticket) => ticket.is_full_hit === true).length,
     pick_hit_rate: pct(hitPicks.length, settledPicks.length)
    },
    daily_tickets: monthData.daily_tickets.sort((a, b) =>
     String(b.ticket_day).localeCompare(String(a.ticket_day))
    ),
    recent_predictions: predictions.slice(0, 30).map((row) => ({
     match_date: row.match_date,
     competition_code: row.competition_code,
     home_team_name: row.home_team_name,
     away_team_name: row.away_team_name,
     predicted_score: row.predicted_score,
     actual_score: `${row.actual_home_goals ?? 0}-${row.actual_away_goals ?? 0}`,
     exact_hit: row.exact_hit,
     winner_hit: row.winner_hit,
     over25_hit: row.over25_hit,
     btts_hit: row.btts_hit
    }))
   };
  });

  const visibleMonths = months.filter((month) => {
   return (
    month.prediction_stats.total > 0 ||
    month.ticket_stats.total_picks > 0 ||
    month.ticket_stats.ticket_days > 0
   );
  });

  return {
   statusCode: 200,
   headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
   },
   body: JSON.stringify({
    ok: true,
    months: visibleMonths
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