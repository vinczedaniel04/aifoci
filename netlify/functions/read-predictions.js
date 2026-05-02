const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    function getTodayUtcDate() {
      const now = new Date();

      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
        2,
        "0"
      )}-${String(now.getUTCDate()).padStart(2, "0")}`;
    }

    function normalizeTeamName(name) {
      return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    }

    function getTeamIdentity(match, side) {
      if (side === "home") {
        return {
          id: match.home_team_id || match.homeTeamId || null,
          name: normalizeTeamName(match.home_team_name)
        };
      }

      return {
        id: match.away_team_id || match.awayTeamId || null,
        name: normalizeTeamName(match.away_team_name)
      };
    }

    function isSameTeam(match, team) {
      const home = getTeamIdentity(match, "home");
      const away = getTeamIdentity(match, "away");

      if (team.id) {
        return String(home.id) === String(team.id) || String(away.id) === String(team.id);
      }

      return home.name === team.name || away.name === team.name;
    }

    function getTeamResult(match, team) {
      const home = getTeamIdentity(match, "home");
      const away = getTeamIdentity(match, "away");

      const homeGoals = Number(match.actual_home_goals);
      const awayGoals = Number(match.actual_away_goals);

      const isHome =
        team.id
          ? String(home.id) === String(team.id)
          : home.name === team.name;

      const isAway =
        team.id
          ? String(away.id) === String(team.id)
          : away.name === team.name;

      if (isHome) {
        if (homeGoals > awayGoals) return "GY";
        if (homeGoals === awayGoals) return "D";
        return "V";
      }

      if (isAway) {
        if (awayGoals > homeGoals) return "GY";
        if (awayGoals === homeGoals) return "D";
        return "V";
      }

      return null;
    }

    function getLastFiveFormFromFinishedMatches(team, currentMatchDate, finishedMatches) {
      const currentTime = new Date(currentMatchDate).getTime();

      return finishedMatches
        .filter((match) => {
          const matchTime = new Date(match.match_date).getTime();

          if (!Number.isFinite(matchTime)) return false;
          if (Number.isFinite(currentTime) && matchTime >= currentTime) return false;

          return isSameTeam(match, team);
        })
        .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())
        .slice(0, 5)
        .map((match) => getTeamResult(match, team))
        .filter(Boolean);
    }

    const today = getTodayUtcDate();

    const { data: todayMatches, error: todayError } = await supabase
      .from("predictions_history")
      .select("*")
      .gte("match_date", `${today}T00:00:00`)
      .lte("match_date", `${today}T23:59:59`)
      .order("match_date", { ascending: true });

    if (todayError) throw todayError;

    const { data: finishedMatches, error: finishedError } = await supabase
      .from("predictions_history")
      .select("*")
      .eq("status", "FINISHED")
      .not("actual_home_goals", "is", null)
      .not("actual_away_goals", "is", null)
      .order("match_date", { ascending: false });

    if (finishedError) throw finishedError;

    const finished = finishedMatches || [];

    const predictionsWithForm = (todayMatches || []).map((match) => {
      const homeTeam = getTeamIdentity(match, "home");
      const awayTeam = getTeamIdentity(match, "away");

      return {
        ...match,
        home_form: getLastFiveFormFromFinishedMatches(
          homeTeam,
          match.match_date,
          finished
        ),
        away_form: getLastFiveFormFromFinishedMatches(
          awayTeam,
          match.match_date,
          finished
        )
      };
    });

    const overallStats = {
      total: finished.length,
      exact: finished.filter((m) => m.exact_hit).length,
      over: finished.filter((m) => m.over25_hit).length,
      btts: finished.filter((m) => m.btts_hit).length,
      winner: finished.filter((m) => m.winner_hit).length
    };

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        match_day: today,
        predictions: predictionsWithForm,
        overall_stats: overallStats
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};