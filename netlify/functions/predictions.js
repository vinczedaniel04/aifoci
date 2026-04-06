let dailyFinishedPredictionsCache = {};
let shortActiveCache = {
  time: 0,
  data: null
};

exports.handler = async function () {
  try {
    const token = process.env.FOOTBALL_DATA_API_KEY;

    if (!token) {
      return {
        statusCode: 500,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          error: "FOOTBALL_DATA_API_KEY nincs beállítva."
        })
      };
    }

    const API_BASE = "https://api.football-data.org/v4";
    const COMPETITIONS = ["PL", "PD","BL1","SA", "FL1",];
    const TEAM_FORM_LIMIT = 2;
    const LEAGUE_AVG_GOALS = 2.6;
    const HOME_ADVANTAGE = 1.1;
    const MAX_ACTIVE_MATCHES = 12;
    const MAX_FINISHED_MATCHES = 12;

    async function fetchJson(url) {
      const response = await fetch(url, {
        headers: {
          "X-Auth-Token": token
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${text}`);
      }

      return await response.json();
    }

    function getDayKey() {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate()
      ).padStart(2, "0")}`;
    }

    function mapMatch(m) {
      return {
        id: m.id,
        utcDate: m.utcDate,
        status: m.status,
        matchday: m.matchday || null,
        competitionCode: m.competition.code,
        competitionName: m.competition.name,
        homeTeam: {
          id: m.homeTeam.id,
          name: m.homeTeam.name
        },
        awayTeam: {
          id: m.awayTeam.id,
          name: m.awayTeam.name
        },
        score: {
          fullTime: {
            home: m.score?.fullTime?.home ?? null,
            away: m.score?.fullTime?.away ?? null
          }
        }
      };
    }

    function isFinishedRelevant(dateString) {
      const matchTime = new Date(dateString).getTime();
      const now = Date.now();
      const eighteenHoursAgo = now - 18 * 60 * 60 * 1000;
      return matchTime >= eighteenHoursAgo && matchTime <= now;
    }

    function isActiveRelevant(dateString) {
      const matchTime = new Date(dateString).getTime();
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const eighteenHoursAhead = now + 18 * 60 * 60 * 1000;
      return matchTime >= twoHoursAgo && matchTime <= eighteenHoursAhead;
    }

    async function fetchCompetitionMatches(code) {
      const data = await fetchJson(`${API_BASE}/competitions/${code}/matches`);
      return data.matches || [];
    }

    async function fetchTeamRecentMatches(teamId) {
      const url = `${API_BASE}/teams/${teamId}/matches?status=FINISHED&limit=${TEAM_FORM_LIMIT}`;
      const data = await fetchJson(url);
      return data.matches || [];
    }

    function averageGoalsFor(teamId, matches) {
      const relevant = matches.filter((m) => m.status === "FINISHED");
      if (relevant.length === 0) return 1.2;

      const total = relevant.reduce((sum, match) => {
        const isHome = match.homeTeam.id === teamId;
        const goals = isHome ? match.score.fullTime.home : match.score.fullTime.away;
        return sum + (goals || 0);
      }, 0);

      return total / relevant.length;
    }

    function averageGoalsAgainst(teamId, matches) {
      const relevant = matches.filter((m) => m.status === "FINISHED");
      if (relevant.length === 0) return 1.2;

      const total = relevant.reduce((sum, match) => {
        const isHome = match.homeTeam.id === teamId;
        const goalsAgainst = isHome
          ? match.score.fullTime.away
          : match.score.fullTime.home;
        return sum + (goalsAgainst || 0);
      }, 0);

      return total / relevant.length;
    }

    function factorial(n) {
      if (n <= 1) return 1;
      let result = 1;
      for (let i = 2; i <= n; i += 1) result *= i;
      return result;
    }

    function poisson(lambda, k) {
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
    }

    function predictMatch(homeTeamName, awayTeamName, homeFor, homeAgainst, awayFor, awayAgainst) {
      const homeAttackStrength = homeFor / (LEAGUE_AVG_GOALS / 2);
      const homeDefenseWeakness = homeAgainst / (LEAGUE_AVG_GOALS / 2);
      const awayAttackStrength = awayFor / (LEAGUE_AVG_GOALS / 2);
      const awayDefenseWeakness = awayAgainst / (LEAGUE_AVG_GOALS / 2);

      const expectedHomeGoals =
        (LEAGUE_AVG_GOALS / 2) *
        homeAttackStrength *
        awayDefenseWeakness *
        HOME_ADVANTAGE;

      const expectedAwayGoals =
        (LEAGUE_AVG_GOALS / 2) *
        awayAttackStrength *
        homeDefenseWeakness;

      let bestProbability = 0;
      let bestScore = "0-0";
      let over25 = 0;
      let btts = 0;

      for (let h = 0; h <= 5; h += 1) {
        for (let a = 0; a <= 5; a += 1) {
          const probability =
            poisson(expectedHomeGoals, h) * poisson(expectedAwayGoals, a);

          if (probability > bestProbability) {
            bestProbability = probability;
            bestScore = `${h}-${a}`;
          }

          if (h + a >= 3) over25 += probability;
          if (h > 0 && a > 0) btts += probability;
        }
      }

      const strongerSide =
        expectedHomeGoals >= expectedAwayGoals ? homeTeamName : awayTeamName;

      return {
        expectedHomeGoals: Number(expectedHomeGoals.toFixed(2)),
        expectedAwayGoals: Number(expectedAwayGoals.toFixed(2)),
        bestScore,
        over25Probability: Number((over25 * 100).toFixed(1)),
        bttsProbability: Number((btts * 100).toFixed(1)),
        explanation: `A modell az utolsó ${TEAM_FORM_LIMIT} befejezett meccs formájából számolt. A várható gólok alapján ${homeTeamName} ${expectedHomeGoals.toFixed(
          2
        )} gólos, ${awayTeamName} pedig ${expectedAwayGoals.toFixed(
          2
        )} gólos teljesítményre várható. Az aktuális forma alapján enyhe fölényben van: ${strongerSide}.`
      };
    }

    async function buildPredictions(matches) {
      const recentCache = new Map();

      async function getRecent(teamId) {
        if (recentCache.has(teamId)) {
          return recentCache.get(teamId);
        }

        const matchesForTeam = await fetchTeamRecentMatches(teamId);
        recentCache.set(teamId, matchesForTeam);
        return matchesForTeam;
      }

      return await Promise.all(
        matches.map(async (match) => {
          const [homeRecent, awayRecent] = await Promise.all([
            getRecent(match.homeTeam.id),
            getRecent(match.awayTeam.id)
          ]);

          const homeFor = averageGoalsFor(match.homeTeam.id, homeRecent);
          const homeAgainst = averageGoalsAgainst(match.homeTeam.id, homeRecent);
          const awayFor = averageGoalsFor(match.awayTeam.id, awayRecent);
          const awayAgainst = averageGoalsAgainst(match.awayTeam.id, awayRecent);

          return {
            match,
            prediction: predictMatch(
              match.homeTeam.name,
              match.awayTeam.name,
              homeFor,
              homeAgainst,
              awayFor,
              awayAgainst
            )
          };
        })
      );
    }

    async function getFinishedPredictions() {
      const dayKey = getDayKey();

      if (dailyFinishedPredictionsCache[dayKey]) {
        return dailyFinishedPredictionsCache[dayKey];
      }

      const all = await Promise.all(
        COMPETITIONS.map(async (code) => {
          const matches = await fetchCompetitionMatches(code);

          return matches
            .filter((m) => (m.status || "") === "FINISHED" && isFinishedRelevant(m.utcDate))
            .map(mapMatch);
        })
      );

      const finishedMatches = all
        .flat()
        .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
        .slice(0, MAX_FINISHED_MATCHES);

      const finishedPredictions = await buildPredictions(finishedMatches);

      dailyFinishedPredictionsCache = {
        [dayKey]: finishedPredictions
      };

      return finishedPredictions;
    }

    async function getActivePredictions() {
      const now = Date.now();
      const cacheMs = 60 * 1000;

      if (shortActiveCache.data && now - shortActiveCache.time < cacheMs) {
        return shortActiveCache.data;
      }

      const all = await Promise.all(
        COMPETITIONS.map(async (code) => {
          const matches = await fetchCompetitionMatches(code);

          return matches
            .filter((m) => {
              const status = m.status || "";
              const allowed =
                status === "SCHEDULED" ||
                status === "TIMED" ||
                status === "LIVE" ||
                status === "IN_PLAY" ||
                status === "PAUSED";

              return allowed && isActiveRelevant(m.utcDate);
            })
            .map(mapMatch);
        })
      );

      const activeMatches = all
        .flat()
        .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
        .slice(0, MAX_ACTIVE_MATCHES);

      const activePredictions = await buildPredictions(activeMatches);

      shortActiveCache = {
        time: now,
        data: activePredictions
      };

      return activePredictions;
    }

    const [finishedPredictions, activePredictions] = await Promise.all([
      getFinishedPredictions(),
      getActivePredictions()
    ]);

    const predictions = [...finishedPredictions, ...activePredictions].sort(
      (a, b) => new Date(a.match.utcDate).getTime() - new Date(b.match.utcDate).getTime()
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60"
      },
      body: JSON.stringify({ predictions })
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