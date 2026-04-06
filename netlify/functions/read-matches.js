const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const footballToken = process.env.FOOTBALL_DATA_API_KEY;
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

 if (!footballToken || !supabaseUrl || !supabaseKey) {
 return {
 statusCode: 500,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 error: "Hiányzó FOOTBALL_DATA_API_KEY, SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY"
 })
 };
 }

 const supabase = createClient(supabaseUrl, supabaseKey);
 const API_BASE = "https://api.football-data.org/v4";

 const COMPETITIONS = [
 "PL",
 "PD",
 "BL1",
 "SA",
 "FL1",
 "CL"
 ];

 function isTodayUtc(dateString) {
 const d = new Date(dateString);
 const now = new Date();

 return (
 d.getUTCFullYear() === now.getUTCFullYear() &&
 d.getUTCMonth() === now.getUTCMonth() &&
 d.getUTCDate() === now.getUTCDate()
 );
 }

 async function fetchLeague(code) {
 try {
 const res = await fetch(`${API_BASE}/competitions/${code}/matches`, {
 headers: {
 "X-Auth-Token": footballToken
 }
 });

 const text = await res.text();

 if (!res.ok) {
 return {
 code,
 ok: false,
 status: res.status,
 raw: text,
 matches: []
 };
 }

 let data;
 try {
 data = JSON.parse(text);
 } catch {
 return {
 code,
 ok: false,
 status: 500,
 raw: "Nem sikerült JSON-ként értelmezni az API választ",
 matches: []
 };
 }

 const matches = (data.matches || [])
 .filter((m) => isTodayUtc(m.utcDate))
 .map((m) => ({
 match_id: m.id,
 match_date: m.utcDate,
 competition_code: m.competition?.code || code,
 competition_name: m.competition?.name || code,
 competition_emblem: m.competition?.emblem || null,
 status: m.status || null,

 home_team_id: m.homeTeam?.id || null,
 home_team_name: m.homeTeam?.name || null,
 home_team_crest: m.homeTeam?.crest || null,

 away_team_id: m.awayTeam?.id || null,
 away_team_name: m.awayTeam?.name || null,
 away_team_crest: m.awayTeam?.crest || null,

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
 updated_at: new Date().toISOString()
 }));

 return {
 code,
 ok: true,
 status: 200,
 count: matches.length,
 matches
 };
 } catch (err) {
 return {
 code,
 ok: false,
 status: 500,
 raw: err.message,
 matches: []
 };
 }
 }

 const debug = [];
 const allMatches = [];

 for (const code of COMPETITIONS) {
 const leagueResult = await fetchLeague(code);
 debug.push({
 code: leagueResult.code,
 ok: leagueResult.ok,
 status: leagueResult.status,
 count: leagueResult.count || 0,
 raw: leagueResult.ok ? undefined : leagueResult.raw
 });

 if (leagueResult.matches?.length) {
 allMatches.push(...leagueResult.matches);
 }

 await new Promise((resolve) => setTimeout(resolve, 1200));
 }

 if (allMatches.length === 0) {
 return {
 statusCode: 200,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 ok: false,
 message: "Nem jött be maira szűrt meccs egyik ligából sem.",
 debug
 })
 };
 }

 const { error: deleteError } = await supabase
 .from("matches")
 .delete()
 .neq("match_id", 0);

 if (deleteError) {
 return {
 statusCode: 500,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 error: "Delete hiba a matches táblán",
 details: deleteError.message,
 debug
 })
 };
 }

 const { error: upsertError } = await supabase
 .from("matches")
 .upsert(allMatches, { onConflict: "match_id" });

 if (upsertError) {
 return {
 statusCode: 500,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 error: "Upsert hiba a matches táblán",
 details: upsertError.message,
 firstRow: allMatches[0],
 debug
 })
 };
 }

 return {
 statusCode: 200,
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 ok: true,
 saved: allMatches.length,
 debug
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