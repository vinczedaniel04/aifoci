const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 const footballToken = process.env.FOOTBALL_DATA_API_KEY;

 if (!supabaseUrl || !supabaseKey || !footballToken) {
 return {
 statusCode: 500,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 error: "Hiányzó env változó"
 })
 };
 }

 const supabase = createClient(supabaseUrl, supabaseKey);
 const API_BASE = "https://api.football-data.org/v4";

 function getTodayUtcDate() {
 const now = new Date();
 return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
 now.getUTCDate()
 ).padStart(2, "0")}`;
 }

 const matchDay = getTodayUtcDate();

 async function fetchJson(url) {
 const res = await fetch(url, {
 headers: {
 "X-Auth-Token": footballToken
 }
 });

 if (!res.ok) {
 throw new Error(await res.text());
 }

 return res.json();
 }

 // mai csapatok
 const { data: matches } = await supabase
 .from("matches")
 .select("home_team_id, home_team_name, away_team_id, away_team_name");

 const teamMap = new Map();

 for (const m of matches || []) {
 teamMap.set(m.home_team_id, {
 team_id: m.home_team_id,
 team_name: m.home_team_name
 });

 teamMap.set(m.away_team_id, {
 team_id: m.away_team_id,
 team_name: m.away_team_name
 });
 }

 const teams = Array.from(teamMap.values());

 // már meglévő cache
 const { data: existing } = await supabase
 .from("team_form_cache")
 .select("team_id")
 .eq("match_day", matchDay);

 const existingSet = new Set((existing || []).map(t => t.team_id));

 // csak hiányzó csapatok
 const missingTeams = teams.filter(t => !existingSet.has(t.team_id));

 // LIMIT: max 3 csapat / futás
 const batch = missingTeams.slice(0, 3);

 if (batch.length === 0) {
 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 message: "Minden csapat kész"
 })
 };
 }

 async function getLastFive(teamId) {
 const data = await fetchJson(
 `${API_BASE}/teams/${teamId}/matches?status=FINISHED&limit=5`
 );
 return data.matches || [];
 }

 function buildRow(team, matches) {
 if (!matches.length) {
 return {
 match_day: matchDay,
 team_id: team.team_id,
 team_name: team.team_name,
 avg_goals_for: 1.2,
 avg_goals_against: 1.2,
 avg_goals_for_home: 1.2,
 avg_goals_against_home: 1.2,
 avg_goals_for_away: 1.2,
 avg_goals_against_away: 1.2,
 updated_at: new Date().toISOString()
 };
 }

 let totalFor = 0;
 let totalAgainst = 0;

 for (const m of matches) {
 const isHome = m.homeTeam.id === team.team_id;

 const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
 const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;

 totalFor += gf ?? 0;
 totalAgainst += ga ?? 0;
 }

 const count = matches.length;

 return {
 match_day: matchDay,
 team_id: team.team_id,
 team_name: team.team_name,
 avg_goals_for: Number((totalFor / count).toFixed(2)),
 avg_goals_against: Number((totalAgainst / count).toFixed(2)),
 updated_at: new Date().toISOString()
 };
 }

 const rows = [];

 for (const team of batch) {
 const lastFive = await getLastFive(team.team_id);
 rows.push(buildRow(team, lastFive));
 }

 const { error } = await supabase
 .from("team_form_cache")
 .upsert(rows, { onConflict: "match_day,team_id" });

 if (error) throw error;

 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 processed: batch.length,
 remaining: missingTeams.length - batch.length
 })
 };
 } catch (err) {
 return {
 statusCode: 500,
 body: JSON.stringify({
 error: err.message
 })
 };
 }
};