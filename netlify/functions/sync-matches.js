sync-matches.js

const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
try {
const footballToken = process.env.FOOTBALL_DATA_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!footballToken || !supabaseUrl || !supabaseKey) {
return {
statusCode: 500,
headers: {
"content-type": "application/json"
},
body: JSON.stringify({
error: "Hiányzó FOOTBALL_DATA_API_KEY vagy SUPABASE beállítás"
})
};
}

const supabase = createClient(supabaseUrl, supabaseKey);

const API_BASE = "https://api.football-data.org/v4";
const COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1","CL", "EL","UCL"];

async function fetchJson(url) {
const response = await fetch(url, {
headers: {
"X-Auth-Token": footballToken
}
});

if (!response.ok) {
const text = await response.text();
throw new Error(`${response.status} ${text}`);
}

return await response.json();
}

function isTodayUtc(dateString) {
const d = new Date(dateString);
const now = new Date();

return (
d.getUTCFullYear() === now.getUTCFullYear() &&
d.getUTCMonth() === now.getUTCMonth() &&
d.getUTCDate() === now.getUTCDate()
);
}

const { error: deleteError } = await supabase
.from("matches")
.delete()
.neq("match_id", 0);

if (deleteError) {
throw deleteError;
}

const allMatches = await Promise.all(
COMPETITIONS.map(async (code) => {
const data = await fetchJson(`${API_BASE}/competitions/${code}/matches`);

return (data.matches || [])
.filter((m) => isTodayUtc(m.utcDate))
.map((m) => ({
match_id: m.id,
match_date: m.utcDate,
competition_code: m.competition.code,
competition_name: m.competition.name,
competition_emblem: m.competition.emblem || null,
status: m.status,

home_team_id: m.homeTeam.id,
home_team_name: m.homeTeam.name,
home_team_crest: m.homeTeam.crest || null,

away_team_id: m.awayTeam.id,
away_team_name: m.awayTeam.name,
away_team_crest: m.awayTeam.crest || null,

full_time_home: m.score?.fullTime?.home ?? null,
full_time_away: m.score?.fullTime?.away ?? null,

live_home:
m.score?.fullTime?.home ??
m.score?.halfTime?.home ??
null,

live_away:
m.score?.fullTime?.away ??
m.score?.halfTime?.away ??
null,

minute: null,
source_updated_at: new Date().toISOString()
}));
})
);

const rows = allMatches.flat();

if (rows.length === 0) {
return {
statusCode: 200,
headers: {
"content-type": "application/json"
},
body: JSON.stringify({
ok: true,
saved: 0,
message: "Ma nincs meccs a kiválasztott ligákban."
})
};
}

const { error } = await supabase
.from("matches")
.upsert(rows, { onConflict: "match_id" });

if (error) {
throw error;
}

return {
statusCode: 200,
headers: {
"content-type": "application/json",
"cache-control": "public, max-age=300"
},
body: JSON.stringify({
ok: true,
saved: rows.length,
leagues: [...new Set(rows.map((r) => r.competition_code))]
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