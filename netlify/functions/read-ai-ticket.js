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

const { data: ticket, error: ticketError } = await supabase
.from("ai_tickets")
.select("*")
.eq("ticket_day", today)
.maybeSingle();

if (ticketError) throw ticketError;

if (!ticket) {
return {
statusCode: 200,
headers: { "content-type": "application/json" },
body: JSON.stringify({
ok: true,
ticket: null,
picks: []
})
};
}

const { data: picks, error: picksError } = await supabase
.from("ai_ticket_picks")
.select("*")
.eq("ticket_id", ticket.id)
.order("pick_value", { ascending: false });

if (picksError) throw picksError;

return {
statusCode: 200,
headers: { "content-type": "application/json" },
body: JSON.stringify({
ok: true,
ticket,
picks: picks || []
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