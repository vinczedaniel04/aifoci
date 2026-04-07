const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
try {
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
return {
statusCode: 500,
headers: {
"content-type": "application/json"
},
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

const { data, error } = await supabase
.from("predictions_history")
.select("*")
.gte("match_date", `${matchDay}T00:00:00.000Z`)
.lt("match_date", `${matchDay}T23:59:59.999Z`)
.order("match_date", { ascending: true });

if (error) {
throw error;
}

return {
statusCode: 200,
headers: {
"content-type": "application/json",
"cache-control": "no-store"
},
body: JSON.stringify({
ok: true,
match_day: matchDay,
predictions: data || []
})
};
} catch (error) {
return {
statusCode: 500,
headers: {
"content-type": "application/json"
},
body: JSON.stringify({
error: error.message || "Ismeretlen hiba"
})
};
}
};