const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
try {
const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_SERVICE_ROLE_KEY
);

const footballToken = process.env.FOOTBALL_DATA_API_KEY;

if (!footballToken) {
throw new Error("Hiányzó FOOTBALL_DATA_API_KEY");
}

const API_BASE = "https://api.football-data.org/v4";

const COMPETITIONS = [
"CL",
"PL",
"PD",
"BL1",
"SA",
"FL1",
"PPL",
"DED",
"ELC",
"BSA"
];

function getTodayUtcDate() {
const now = new Date();
return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
now.getUTCDate()
).padStart(2, "0")}`;
}

function isTodayUtc(utcDate) {
return utcDate?.slice(0, 10) === getTodayUtcDate();
}

function normalizeStatus(rawStatus, utcDate) {
const status = (rawStatus || "").toUpperCase();
const now = new Date();
const kickoff = new Date(utcDate);
const diffMinutes = (now.getTime() - kickoff.getTime()) / 60000;

if (status === "TIMED" && diffMinutes >= 2 && diffMinutes < 180) {
return "LIVE";
}

return status || null;
}

async function fetchCompetitionMatches(code) {
const response = await fetch(`${API_BASE}/competitions/${code}/matches`, {
headers: {
"X-Auth-Token": footballToken
}
});

if (!response.ok) {
const text = await response.text();
throw new Error(`${code} fetch hiba: ${response.status} ${text}`);
}

const json = await response.json();
return json.matches || [];
}

let allMatches = [];

for (const code of COMPETITIONS) {
const matches = await fetchCompetitionMatches(code);
allMatches.push(...matches.filter((m) => isTodayUtc(m.utcDate)));
await new Promise((resolve) => setTimeout(resolve, 500));
}

allMatches = allMatches.map((m) => ({
match_id: m.id,
match_date: m.utcDate,
competition_code: m.competition?.code || "",
competition_name: m.competition?.name || "",
competition_emblem: m.competition?.emblem || null,
status: normalizeStatus(m.status, m.utcDate),

home_team_id: m.homeTeam?.id,
home_team_name: m.homeTeam?.name || "",
home_team_crest: m.homeTeam?.crest || null,

away_team_id: m.awayTeam?.id,
away_team_name: m.awayTeam?.name || "",
away_team_crest: m.awayTeam?.crest || null,

full_time_home: m.score?.fullTime?.home ?? null,
full_time_away: m.score?.fullTime?.away ?? null,

live_home: m.score?.fullTime?.home ?? m.score?.halfTime?.home ?? null,
live_away: m.score?.fullTime?.away ?? m.score?.halfTime?.away ?? null,
minute: null,

source_updated_at: new Date().toISOString(),
updated_at: new Date().toISOString()
}));

if (allMatches.length === 0) {
return {
statusCode: 200,
body: JSON.stringify({
ok: true,
inserted: 0,
updated: 0,
match_day: getTodayUtcDate()
})
};
}

const { error } = await supabase
.from("matches")
.upsert(allMatches, { onConflict: "match_id" });

if (error) throw error;

return {
statusCode: 200,
body: JSON.stringify({
ok: true,
inserted: 0,
updated: allMatches.length,
match_day: getTodayUtcDate()
})
};
} catch (error) {
return {
statusCode: 500,
body: JSON.stringify({
error: error.message || "Ismeretlen hiba"
})
};
}
};