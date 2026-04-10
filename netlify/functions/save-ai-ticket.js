const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
try {
const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getTodayUtcDate() {
const now = new Date();
return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
now.getUTCDate()
).padStart(2, "0")}`;
}

const today = getTodayUtcDate();

const { data: existingTicket, error: existingTicketError } = await supabase
.from("ai_tickets")
.select("id, ticket_day")
.eq("ticket_day", today)
.maybeSingle();

if (existingTicketError) throw existingTicketError;

if (existingTicket) {
return {
statusCode: 200,
headers: { "content-type": "application/json" },
body: JSON.stringify({
ok: true,
already_exists: true,
ticket_id: existingTicket.id,
ticket_day: today
})
};
}

const { data: predictions, error: predictionsError } = await supabase
.from("predictions_history")
.select("*")
.gte("match_date", `${today}T00:00:00`)
.lte("match_date", `${today}T23:59:59`)
.order("match_date", { ascending: true });

if (predictionsError) throw predictionsError;

const rows = predictions || [];
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

const finalPicks = deduped.slice(0, 5);

const { data: ticketInsert, error: ticketInsertError } = await supabase
.from("ai_tickets")
.insert({
ticket_day: today,
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
statusCode: 200,
headers: { "content-type": "application/json" },
body: JSON.stringify({
ok: true,
ticket_id: ticketInsert.id,
ticket_day: today,
saved_picks: finalPicks.length,
picks: finalPicks
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