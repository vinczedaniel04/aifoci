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

    const matchDay = getTodayUtcDate();

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
      .select("home_team_id, home_team_name, away_team_id, away_team_name")
      .order("match_date", { ascending: true });

    if (matchesError) {
      throw matchesError;
    }

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

    async function getLastFiveMatches(teamId) {
      const data = await fetchJson(
        `${API_BASE}/teams/${teamId}/matches?status=FINISHED&limit=5`
      );
      return data.matches || [];
    }

    function buildTeamFormRow(team, matches) {
      if (!matches.length) {
        return {
          match_day: matchDay,
          team_id: team.team_id,
          team_name: team.team_name,
          last_5_count: 0,
          avg_goals_for: 1.2,
          avg_goals_against: 1.2,
          avg_goals_for_home: 1.2,
          avg_goals_against_home: 1.2,
          avg_goals_for_away: 1.2,
          avg_goals_against_away: 1.2,
          wins_last_5: 0,
          draws_last_5: 0,
          losses_last_5: 0,
          updated_at: new Date().toISOString()
        };
      }

      let totalFor = 0;
      let totalAgainst = 0;

      let totalForHome = 0;
      let totalAgainstHome = 0;
      let totalForAway = 0;
      let totalAgainstAway = 0;

      let homeCount = 0;
      let awayCount = 0;

      let wins = 0;
      let draws = 0;
      let losses = 0;

      for (const match of matches) {
        const isHome = match.homeTeam.id === team.team_id;

        const goalsFor = isHome ? match.score?.fullTime?.home : match.score?.fullTime?.away;
        const goalsAgainst = isHome ? match.score?.fullTime?.away : match.score?.fullTime?.home;

        totalFor += goalsFor ?? 0;
        totalAgainst += goalsAgainst ?? 0;

        if (isHome) {
          totalForHome += goalsFor ?? 0;
          totalAgainstHome += goalsAgainst ?? 0;
          homeCount++;
        } else {
          totalForAway += goalsFor ?? 0;
          totalAgainstAway += goalsAgainst ?? 0;
          awayCount++;
        }

        if ((goalsFor ?? 0) > (goalsAgainst ?? 0)) wins++;
        else if ((goalsFor ?? 0) === (goalsAgainst ?? 0)) draws++;
        else losses++;
      }

      const count = matches.length;

      return {
        match_day: matchDay,
        team_id: team.team_id,
        team_name: team.team_name,
        last_5_count: count,
        avg_goals_for: Number((totalFor / count).toFixed(2)),
        avg_goals_against: Number((totalAgainst / count).toFixed(2)),
        avg_goals_for_home: Number(((homeCount ? totalForHome / homeCount : totalFor / count)).toFixed(2)),
        avg_goals_against_home: Number(((homeCount ? totalAgainstHome / homeCount : totalAgainst / count)).toFixed(2)),
        avg_goals_for_away: Number(((awayCount ? totalForAway / awayCount : totalFor / count)).toFixed(2)),
        avg_goals_against_away: Number(((awayCount ? totalAgainstAway / awayCount : totalAgainst / count)).toFixed(2)),
        wins_last_5: wins,
        draws_last_5: draws,
        losses_last_5: losses,
        updated_at: new Date().toISOString()
      };
    }

    const rows = await Promise.all(
      teams.map(async (team) => {
        const lastFive = await getLastFiveMatches(team.team_id);
        return buildTeamFormRow(team, lastFive);
      })
    );

    const { error: upsertError } = await supabase
      .from("team_form_cache")
      .upsert(rows, { onConflict: "match_day,team_id" });

    if (upsertError) {
      throw upsertError;
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ok: true,
        saved: rows.length,
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