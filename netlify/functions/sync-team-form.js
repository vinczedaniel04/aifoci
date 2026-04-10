const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 const footballToken = process.env.FOOTBALL_DATA_API_KEY;

 if (!supabaseUrl || !supabaseKey || !footballToken) {
 return {
 statusCode: 500,
 headers: {
 "content-type": "application/json"
 },
 body: JSON.stringify({
 error: "Hiányzó SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY vagy FOOTBALL_DATA_API_KEY"
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

 function getSeasonStartYearUtc() {
 const now = new Date();
 const year = now.getUTCFullYear();
 const month = now.getUTCMonth() + 1;
 return month >= 7 ? year : year - 1;
 }

 const matchDay = getTodayUtcDate();
 const season = getSeasonStartYearUtc();

 const LEAGUE_STRENGTH = {
 CL: 1.00,
 PL: 1.00,
 PD: 0.97,
 BL1: 0.96,
 SA: 0.95,
 FL1: 0.93,
 PPL: 0.88,
 DED: 0.89,
 ELC: 0.87,
 BSA: 0.90,
 OTHERS: 0.90
 };

 function getLeagueStrength(code) {
 return LEAGUE_STRENGTH[code] ?? LEAGUE_STRENGTH.OTHERS;
 }

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

 const { data: todayMatches, error: matchesError } = await supabase
 .from("matches")
 .select("match_date,status,home_team_id,home_team_name,away_team_id,away_team_name")
 .gte("match_date", `${matchDay}T00:00:00`)
 .lte("match_date", `${matchDay}T23:59:59`)
 .order("match_date", { ascending: true });

 if (matchesError) throw matchesError;

 const teamsMap = new Map();

 for (const match of todayMatches || []) {
 teamsMap.set(match.home_team_id, {
 team_id: match.home_team_id,
 team_name: match.home_team_name
 });

 teamsMap.set(match.away_team_id, {
 team_id: match.away_team_id,
 team_name: match.away_team_name
 });
 }

 const teams = Array.from(teamsMap.values());

 if (teams.length === 0) {
 return {
 statusCode: 200,
 headers: {
 "content-type": "application/json"
 },
 body: JSON.stringify({
 ok: true,
 copied_from_cache: 0,
 fetched_new: 0,
 remaining_new_teams: 0,
 season,
 match_day: matchDay
 })
 };
 }

 const { data: seasonCacheRows, error: cacheError } = await supabase
 .from("team_form_cache")
 .select("*")
 .eq("season", season)
 .order("updated_at", { ascending: false });

 if (cacheError) throw cacheError;

 const latestSeasonCacheByTeam = new Map();
 const todayCacheByTeam = new Map();

 for (const row of seasonCacheRows || []) {
 if (!latestSeasonCacheByTeam.has(row.team_id)) {
 latestSeasonCacheByTeam.set(row.team_id, row);
 }

 if (row.match_day === matchDay && !todayCacheByTeam.has(row.team_id)) {
 todayCacheByTeam.set(row.team_id, row);
 }
 }

 const rowsToCopy = [];
 const teamsToFetch = [];

 for (const team of teams) {
 const todayCache = todayCacheByTeam.get(team.team_id);
 const latestCache = latestSeasonCacheByTeam.get(team.team_id);

 if (todayCache) {
 continue;
 }

 if (latestCache) {
 const { id, ...copyRow } = latestCache;
 rowsToCopy.push({
 ...copyRow,
 match_day: matchDay,
 season,
 updated_at: new Date().toISOString()
 });
 } else {
 teamsToFetch.push(team);
 }
 }

 if (rowsToCopy.length > 0) {
 const { error: copyError } = await supabase
 .from("team_form_cache")
 .upsert(rowsToCopy, { onConflict: "match_day,team_id" });

 if (copyError) throw copyError;
 }

 // Free tier miatt egyszerre csak keveset kérünk le
 const batch = teamsToFetch.slice(0, 2);

 async function getRecentFinishedMatches(teamId) {
 const data = await fetchJson(
 `${API_BASE}/teams/${teamId}/matches?status=FINISHED&limit=40`
 );
 return data.matches || [];
 }

 function weightedAverage(values, fallback = 0) {
 if (!values.length) return fallback;

 let weightedSum = 0;
 let totalWeight = 0;

 for (let i = 0; i < values.length; i += 1) {
 const weight = values.length - i;
 weightedSum += values[i] * weight;
 totalWeight += weight;
 }

 return Number((weightedSum / totalWeight).toFixed(2));
 }

 function weightedRate(values, fallback = 0) {
 if (!values.length) return fallback;

 let weightedSum = 0;
 let totalWeight = 0;

 for (let i = 0; i < values.length; i += 1) {
 const weight = values.length - i;
 weightedSum += values[i] * weight;
 totalWeight += weight;
 }

 return Number((((weightedSum / totalWeight) || 0) * 100).toFixed(2));
 }

 function buildTeamFormRow(team, matches) {
 const sortedMatches = [...matches].sort(
 (a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime()
 );

 const homeMatches = sortedMatches
 .filter((m) => m.homeTeam?.id === team.team_id)
 .slice(0, 10);

 const awayMatches = sortedMatches
 .filter((m) => m.awayTeam?.id === team.team_id)
 .slice(0, 10);

 const recentAllMatches = sortedMatches.slice(0, 5);

 function mapStats(matchList, isHome) {
 return matchList.map((m) => {
 const goalsFor = isHome
 ? (m.score?.fullTime?.home ?? 0)
 : (m.score?.fullTime?.away ?? 0);

 const goalsAgainst = isHome
 ? (m.score?.fullTime?.away ?? 0)
 : (m.score?.fullTime?.home ?? 0);

 const competitionCode = m.competition?.code || "";
 const leagueStrength = getLeagueStrength(competitionCode);

 return {
 goalsFor,
 goalsAgainst,
 over25: goalsFor + goalsAgainst >= 3 ? 1 : 0,
 btts: goalsFor > 0 && goalsAgainst > 0 ? 1 : 0,
 win: goalsFor > goalsAgainst ? 1 : 0,
 draw: goalsFor === goalsAgainst ? 1 : 0,
 loss: goalsFor < goalsAgainst ? 1 : 0,
 leagueStrength
 };
 });
 }

 function mapRecentAllStats(matchList) {
 return matchList.map((m) => {
 const isHome = m.homeTeam?.id === team.team_id;

 const goalsFor = isHome
 ? (m.score?.fullTime?.home ?? 0)
 : (m.score?.fullTime?.away ?? 0);

 const goalsAgainst = isHome
 ? (m.score?.fullTime?.away ?? 0)
 : (m.score?.fullTime?.home ?? 0);

 return {
 goalsFor,
 goalsAgainst,
 win: goalsFor > goalsAgainst ? 1 : 0,
 draw: goalsFor === goalsAgainst ? 1 : 0,
 loss: goalsFor < goalsAgainst ? 1 : 0
 };
 });
 }

 const homeStats = mapStats(homeMatches, true);
 const awayStats = mapStats(awayMatches, false);
 const recentAllStats = mapRecentAllStats(recentAllMatches);

 const combinedStats = [...homeStats, ...awayStats];

 const avgLeagueStrength = weightedAverage(
 combinedStats.map((x) => x.leagueStrength ?? 0.9),
 0.9
 );

 const lastFinishedMatchDate =
 sortedMatches.length > 0 ? sortedMatches[0].utcDate : null;

 return {
 match_day: matchDay,
 season,
 team_id: team.team_id,
 team_name: team.team_name,

 last_5_count: Math.min(recentAllMatches.length, 5),
 home_last_10_count: homeMatches.length,
 away_last_10_count: awayMatches.length,

 avg_goals_for: weightedAverage(combinedStats.map((x) => x.goalsFor), 1.2),
 avg_goals_against: weightedAverage(combinedStats.map((x) => x.goalsAgainst), 1.2),

 avg_goals_for_home: weightedAverage(homeStats.map((x) => x.goalsFor), 1.2),
 avg_goals_against_home: weightedAverage(homeStats.map((x) => x.goalsAgainst), 1.1),

 avg_goals_for_away: weightedAverage(awayStats.map((x) => x.goalsFor), 1.0),
 avg_goals_against_away: weightedAverage(awayStats.map((x) => x.goalsAgainst), 1.1),

 wins_last_5: recentAllStats.filter((x) => x.win).length,
 draws_last_5: recentAllStats.filter((x) => x.draw).length,
 losses_last_5: recentAllStats.filter((x) => x.loss).length,

 home_win_rate: weightedRate(homeStats.map((x) => x.win), 0),
 home_draw_rate: weightedRate(homeStats.map((x) => x.draw), 0),
 home_loss_rate: weightedRate(homeStats.map((x) => x.loss), 0),

 away_win_rate: weightedRate(awayStats.map((x) => x.win), 0),
 away_draw_rate: weightedRate(awayStats.map((x) => x.draw), 0),
 away_loss_rate: weightedRate(awayStats.map((x) => x.loss), 0),

 home_over25_rate: weightedRate(homeStats.map((x) => x.over25), 0),
 away_over25_rate: weightedRate(awayStats.map((x) => x.over25), 0),

 home_btts_rate: weightedRate(homeStats.map((x) => x.btts), 0),
 away_btts_rate: weightedRate(awayStats.map((x) => x.btts), 0),

 source_league_strength: avgLeagueStrength,
 last_finished_match_date: lastFinishedMatchDate,
 updated_at: new Date().toISOString()
 };
 }

 const fetchedRows = [];

 for (const team of batch) {
 const recentMatches = await getRecentFinishedMatches(team.team_id);
 fetchedRows.push(buildTeamFormRow(team, recentMatches));
 await new Promise((resolve) => setTimeout(resolve, 1800));
 }

 if (fetchedRows.length > 0) {
 const { error: upsertError } = await supabase
 .from("team_form_cache")
 .upsert(fetchedRows, { onConflict: "match_day,team_id" });

 if (upsertError) throw upsertError;
 }

 return {
 statusCode: 200,
 headers: {
 "content-type": "application/json"
 },
 body: JSON.stringify({
 ok: true,
 copied_from_cache: rowsToCopy.length,
 fetched_new: fetchedRows.length,
 remaining_new_teams: Math.max(teamsToFetch.length - batch.length, 0),
 total_today_teams: teams.length,
 season,
 match_day: matchDay
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