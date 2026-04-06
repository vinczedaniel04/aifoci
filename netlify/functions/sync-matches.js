const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const footballToken = process.env.FOOTBALL_DATA_API_KEY;
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

 if (!footballToken || !supabaseUrl || !supabaseKey) {
 return {
 statusCode: 500,
 body: JSON.stringify({
 error: "Hiányzó env változó"
 })
 };
 }

 const supabase = createClient(supabaseUrl, supabaseKey);
 const API_BASE = "https://api.football-data.org/v4";

 // FONTOS: csak ezek mennek FREE-ben!
 const COMPETITIONS = [
 "PL", // Premier League
 "PD", // La Liga
 "BL1", // Bundesliga
 "SA", // Serie A
 "FL1" // Ligue 1
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

 if (!res.ok) {
 const txt = await res.text();
 console.error(` ${code} hiba:`, txt);
 return [];
 }

 const data = await res.json();

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

 minute: m.minute ?? null,
 updated_at: new Date().toISOString()
 }));

 } catch (err) {
 console.error(` ${code} fetch crash:`, err.message);
 return [];
 }
 }

 // ligák sorban (nem párhuzamos → nem léped túl limitet)
 let allMatches = [];

 for (const code of COMPETITIONS) {
 const leagueMatches = await fetchLeague(code);
 allMatches.push(...leagueMatches);

 // kis delay hogy ne bannoljon API
 await new Promise(r => setTimeout(r, 1200));
 }

 console.log("Összes meccs:", allMatches.length);

 // HA NINCS adat → NEM törlünk!
 if (allMatches.length === 0) {
 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: false,
 message: "Nincs adat az API-ból (valószínű limit vagy hiba)"
 })
 };
 }

 // csak akkor törlünk ha VAN adat
 const { error: deleteError } = await supabase
 .from("matches")
 .delete()
 .neq("match_id", 0);

 if (deleteError) {
 throw deleteError;
 }

 const { error: insertError } = await supabase
 .from("matches")
 .upsert(allMatches, { onConflict: "match_id" });

 if (insertError) {
 throw insertError;
 }

 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 saved: allMatches.length
 })
 };

 } catch (error) {
 console.error("SYNC ERROR:", error);

 return {
 statusCode: 500,
 body: JSON.stringify({
 error: error.message
 })
 };
 }
};