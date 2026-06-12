const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
 try {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const footballToken = process.env.FOOTBALL_DATA_API_KEY;
  
  // Az új API kulcsod biztonságosan beépítve a hibrid rendszerhez
  const apiFootballKey = process.env.API_FOOTBALL_KEY || "c6ed43e5d41d4020985d034da95fb830";

  if (!supabaseUrl || !supabaseKey || !footballToken) {
   return {
    statusCode: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "Hiányzó alapvető API kulcsok" })
   };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const API_BASE = "https://api.football-data.org/v4";

  function getLogicalDates() {
   const now = new Date();
   now.setHours(now.getHours() - 6);

   const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

   const tomorrow = new Date(now);
   tomorrow.setDate(tomorrow.getDate() + 1);
   const tomorrowStr = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;

   const startOfDay = `${todayStr}T00:00:00.000Z`;
   const endOfDay = `${tomorrowStr}T06:00:00.000Z`;

   return { matchDay: todayStr, startOfDay, endOfDay };
  }

  function getSeasonStartYearUtc() {
   const now = new Date();
   const year = now.getUTCFullYear();
   const month = now.getUTCMonth() + 1;
   return month >= 7 ? year : year - 1;
  }

  const { matchDay, startOfDay, endOfDay } = getLogicalDates();
  const season = getSeasonStartYearUtc();

  const LEAGUE_STRENGTH = {
   CL: 1.0,
   PL: 1.0,
   PD: 0.97,
   BL1: 0.96,
   SA: 0.95,
   FL1: 0.93,
   DED: 0.89,
   WC: 1.0,
   OTHERS: 0.9
  };

  function getLeagueStrength(code) {
   return LEAGUE_STRENGTH[code] ?? LEAGUE_STRENGTH.OTHERS;
  }

  function normalizeFormArray(value) {
   if (!Array.isArray(value)) return [];
   return value
    .map((x) => String(x || "").toUpperCase())
    .filter((x) => ["GY", "D", "V"].includes(x))
    .slice(0, 5);
  }

  async function fetchJson(url, options = {}) {
   const response = await fetch(url, options);
   if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
   }
   return await response.json();
  }

  const { data: todayMatches, error: matchesError } = await supabase
   .from("matches")
   .select("match_date,status,home_team_id,home_team_name,away_team_id,away_team_name")
   .gte("match_date", startOfDay)
   .lte("match_date", endOfDay)
   .order("match_date", { ascending: true });

  if (matchesError) throw matchesError;

  const teamsMap = new Map();

  for (const match of todayMatches || []) {
   if (match.home_team_id) {
    teamsMap.set(match.home_team_id, {
     team_id: match.home_team_id,
     team_name: match.home_team_name
    });
   }
   if (match.away_team_id) {
    teamsMap.set(match.away_team_id, {
     team_id: match.away_team_id,
     team_name: match.away_team_name
    });
   }
  }

  const teams = Array.from(teamsMap.values());

  if (teams.length === 0) {
   return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, total_today_teams: 0, match_day: matchDay })
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

   const todayForm = normalizeFormArray(todayCache?.last_5_form);
   const latestForm = normalizeFormArray(latestCache?.last_5_form);

   if (todayCache && todayForm.length >= 5) {
    continue;
   }

   if (latestCache && latestForm.length >= 5) {
    const { id, ...copyRow } = latestCache;
    rowsToCopy.push({
     ...copyRow,
     match_day: matchDay,
     season,
     last_5_count: 5,
     last_5_form: latestForm.slice(0, 5),
     updated_at: new Date().toISOString()
    });
   } else {
    teamsToFetch.push(team);
   }
  }

  if (rowsToCopy.length > 0) {
   const { error: copyError } = await supabase
    .from("team_form_cache")
    .upsert(rowsToCopy, { onConflict: "season,team_id" });
   if (copyError) throw copyError;
  }

  const batch = teamsToFetch.slice(0, 4);

  // HIBRID ADATLEKÉRŐ FÜGGVÉNY (Elsődleges + Biztonsági API)
  async function getRecentFinishedMatchesHybrid(team) {
    let matches = [];
    
    // 1. Próba az elsődleges API-n (Klubcsapatoknak tökéletes)
    try {
      const data = await fetchJson(
        `${API_BASE}/teams/${team.team_id}/matches?status=FINISHED&limit=40`,
        { headers: { "X-Auth-Token": footballToken } }
      );
      matches = data.matches || [];
    } catch (e) {
      console.error("Elsődleges API hiba a következőnél:", team.team_name, e.message);
    }

    // Ha megvan a kellő statisztika, egyből visszaadjuk
    if (matches.length >= 5) {
      return matches;
    }

    // 2. Biztonsági háló: Ha üres a lista (Válogatottak), jön az API-Football!
    console.log(`Váltás a biztonsági API-ra a(z) ${team.team_name} csapathoz...`);
    try {
      // Csapat keresése név alapján
      const searchUrl = `https://v3.football.api-sports.io/teams?search=${encodeURIComponent(team.team_name)}`;
      const searchRes = await fetch(searchUrl, {
        headers: { "x-apisports-key": apiFootballKey }
      });
      const searchData = await searchRes.json();

      if (!searchData.response || searchData.response.length === 0) {
        return matches; // Nem találtuk a biztonsági API-ban sem
      }

      const apiTeamId = searchData.response[0].team.id;

      // Legutóbbi befejezett meccsek letöltése a megtalált azonosítóval
      const fixUrl = `https://v3.football.api-sports.io/fixtures?team=${apiTeamId}&last=30`;
      const fixRes = await fetch(fixUrl, {
        headers: { "x-apisports-key": apiFootballKey }
      });
      const fixData = await fixRes.json();

      if (!fixData.response) return matches;

      // Lefordítjuk az új API adatait a te adatbázisod (a régi API) nyelvére
      const mappedMatches = fixData.response
        .filter(f => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short)) // Csak a befejezettek
        .map(f => {
          const isHome = f.teams.home.id === apiTeamId;
          const homeGoals = f.goals.home ?? 0;
          const awayGoals = f.goals.away ?? 0;

          return {
            utcDate: f.fixture.date,
            homeTeam: { id: isHome ? team.team_id : 'other' },
            awayTeam: { id: !isHome ? team.team_id : 'other' },
            score: {
              fullTime: { home: homeGoals, away: awayGoals }
            },
            competition: { code: 'WC' } // Magas szorzót kapnak az itteni adatok (1.0)
          };
      });

      return mappedMatches;
    } catch (e) {
      console.error("Biztonsági API hiba a következőnél:", team.team_name, e.message);
      return matches;
    }
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

   const homeMatches = sortedMatches.filter((m) => m.homeTeam?.id === team.team_id).slice(0, 10);
   const awayMatches = sortedMatches.filter((m) => m.awayTeam?.id === team.team_id).slice(0, 10);
   const last10AllMatches = sortedMatches.slice(0, 10);
   const recentAllMatches = sortedMatches.slice(0, 5);

   function mapFormResult(match) {
    const isHome = match.homeTeam?.id === team.team_id;
    const isAway = match.awayTeam?.id === team.team_id;
    if (!isHome && !isAway) return null;
    const goalsFor = isHome ? match.score?.fullTime?.home : match.score?.fullTime?.away;
    const goalsAgainst = isHome ? match.score?.fullTime?.away : match.score?.fullTime?.home;

    if (goalsFor == null || goalsAgainst == null) return null;
    if (goalsFor > goalsAgainst) return "GY";
    if (goalsFor === goalsAgainst) return "D";
    return "V";
   }

   const last5Form = recentAllMatches.map(mapFormResult).filter(Boolean).slice(0, 5);

   function mapStats(matchList, isHome) {
    return matchList.map((m) => {
     const goalsFor = isHome ? (m.score?.fullTime?.home ?? 0) : (m.score?.fullTime?.away ?? 0);
     const goalsAgainst = isHome ? (m.score?.fullTime?.away ?? 0) : (m.score?.fullTime?.home ?? 0);
     const competitionCode = m.competition?.code || "OTHERS";
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

   function mapAllStats(matchList) {
    return matchList.map((m) => {
     const isHome = m.homeTeam?.id === team.team_id;
     const goalsFor = isHome ? (m.score?.fullTime?.home ?? 0) : (m.score?.fullTime?.away ?? 0);
     const goalsAgainst = isHome ? (m.score?.fullTime?.away ?? 0) : (m.score?.fullTime?.home ?? 0);

     return {
      goalsFor,
      goalsAgainst,
      over25: goalsFor + goalsAgainst >= 3 ? 1 : 0,
      btts: goalsFor > 0 && goalsAgainst > 0 ? 1 : 0,
      win: goalsFor > goalsAgainst ? 1 : 0,
      draw: goalsFor === goalsAgainst ? 1 : 0,
      loss: goalsFor < goalsAgainst ? 1 : 0
     };
    });
   }

   const homeStats = mapStats(homeMatches, true);
   const awayStats = mapStats(awayMatches, false);
   const last10Stats = mapAllStats(last10AllMatches);
   const recentAllStats = mapAllStats(recentAllMatches);
   const combinedStats = [...homeStats, ...awayStats];

   const avgLeagueStrength = weightedAverage(
    combinedStats.map((x) => x.leagueStrength ?? 0.9),
    0.9
   );

   const lastFinishedMatchDate = sortedMatches.length > 0 ? sortedMatches[0].utcDate : null;

   return {
    match_day: matchDay,
    season,
    team_id: team.team_id,
    team_name: team.team_name,
    last_5_count: last5Form.length,
    last_5_form: last5Form,
    home_last_10_count: homeMatches.length,
    away_last_10_count: awayMatches.length,
    last10_avg_goals_for: weightedAverage(last10Stats.map((x) => x.goalsFor), 1.3),
    last10_avg_goals_against: weightedAverage(last10Stats.map((x) => x.goalsAgainst), 1.2),
    last10_over25_rate: weightedRate(last10Stats.map((x) => x.over25), 0),
    last10_btts_rate: weightedRate(last10Stats.map((x) => x.btts), 0),
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
  const fetchedTeams = [];

  for (const team of batch) {
   // Itt hívjuk meg az új, Hibrid függvényünket!
   const recentMatches = await getRecentFinishedMatchesHybrid(team);
   const row = buildTeamFormRow(team, recentMatches);

   fetchedRows.push(row);
   fetchedTeams.push({
    team_id: team.team_id,
    team_name: team.team_name,
    fetched_matches: recentMatches.length,
    last_5_count: row.last_5_count,
    last_5_form: row.last_5_form
   });

   await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  if (fetchedRows.length > 0) {
   const { error: upsertError } = await supabase
    .from("team_form_cache")
    .upsert(fetchedRows, { onConflict: "season,team_id" });
   if (upsertError) throw upsertError;
  }

  return {
   statusCode: 200,
   headers: { "content-type": "application/json" },
   body: JSON.stringify({
    ok: true,
    copied_from_cache: rowsToCopy.length,
    fetched_new: fetchedRows.length,
    fetched_teams: fetchedTeams,
    remaining_new_teams: Math.max(teamsToFetch.length - batch.length, 0),
    total_today_teams: teams.length,
    season,
    match_day: matchDay
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