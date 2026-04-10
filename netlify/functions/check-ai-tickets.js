const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const supabase = createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE_KEY
 );

 // lekérjük az összes ticket picket
 const { data: picks, error: picksError } = await supabase
 .from("ai_ticket_picks")
 .select("*");

 if (picksError) throw picksError;

 for (const pick of picks) {
 // meccs adat lekérése
 const { data: match } = await supabase
 .from("matches")
 .select("*")
 .eq("match_id", pick.match_id)
 .maybeSingle();

 if (!match) continue;

 if (match.status !== "FINISHED") continue;

 let isHit = false;

 const home = match.full_time_home;
 const away = match.full_time_away;

 if (home === null || away === null) continue;

 // LOGIKA
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

 // frissítjük a picket
 await supabase
 .from("ai_ticket_picks")
 .update({ is_hit: isHit })
 .eq("id", pick.id);
 }

 // ticket összesítés
 const { data: tickets } = await supabase
 .from("ai_tickets")
 .select("*");

 for (const ticket of tickets) {
 const { data: ticketPicks } = await supabase
 .from("ai_ticket_picks")
 .select("*")
 .eq("ticket_id", ticket.id);

 if (!ticketPicks || ticketPicks.length === 0) continue;

 const hits = ticketPicks.filter(p => p.is_hit === true).length;
 const allFinished = ticketPicks.every(p => p.is_hit !== null);

 const isFullHit = allFinished && hits === ticketPicks.length;

 await supabase
 .from("ai_tickets")
 .update({
 hits,
 is_full_hit: isFullHit
 })
 .eq("id", ticket.id);
 }

 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 message: "Tickets frissítve"
 })
 };

 } catch (err) {
 return {
 statusCode: 500,
 body: JSON.stringify({ error: err.message })
 };
 }
};