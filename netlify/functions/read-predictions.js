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

const { data: todayMatches, error: todayError } = await supabase
.from("predictions_history")
.select("*")
.gte("match_date", `${today}T00:00:00`)
.lte("match_date", `${today}T23:59:59`)
.order("match_date", { ascending: true });

if (todayError) throw todayError;

const { data: finishedMatches, error: finishedError } = await supabase
.from("predictions_history")
.select("*")
.eq("status", "FINISHED")
.not("actual_home_goals", "is", null)
.not("actual_away_goals", "is", null);

if (finishedError) throw finishedError;

const finished = finishedMatches || [];

const overallStats = {
total: finished.length,
exact: finished.filter((m) => m.exact_hit).length,
over: finished.filter((m) => m.over25_hit).length,
btts: finished.filter((m) => m.btts_hit).length,
winner: finished.filter((m) => m.winner_hit).length
};

return {
statusCode: 200,
headers: {
"content-type": "application/json"
},
body: JSON.stringify({
ok: true,
match_day: today,
predictions: todayMatches || [],
overall_stats: overallStats
})
};
} catch (err) {
return {
statusCode: 500,
headers: {
"content-type": "application/json"
},
body: JSON.stringify({
error: err.message
})
};
}
};