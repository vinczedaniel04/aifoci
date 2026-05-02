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
      return String(name || "").trim();
    }

    function getTeamResult(match, teamName) {
      const team = normalizeTeamName(teamName);
      const homeTeam = normalizeTeamName(match.home_team_name);
      const awayTeam = normalizeTeamName(match.away_team_name);

      const homeGoals = Number(match.actual_home_goals);
      const awayGoals = Number(match.actual_away_goals);

      if (homeTeam === team) {
        if (homeGoals > awayGoals) return "GY";
        if (homeGoals === awayGoals) return "D";
        return "V";
      }

      if (awayTeam === team) {
        if (awayGoals > homeGoals) return "GY";
        if (awayGoals === homeGoals) return "D";
        return "V";
      }

      return null;
    }

    async function getLastFiveForm(teamName, beforeDate) {
      const team = normalizeTeamName(teamName);

      if (!team) return [];

      const { data, error } = await supabase
        .from("predictions_history")
        .select(
          "match_date, home_team_name, away_team_name, actual_home_goals, actual_away_goals, status"
        )
        .eq("status", "FINISHED")
        .not("actual_home_goals", "is", null)
        .not("actual_away_goals", "is", null)
        .lt("match_date", beforeDate)
        .or(`home_team_name.eq.${team},away_team_name.eq.${team}`)
        .order("match_date", { ascending: false })
        .limit(5);

      if (error) {
        console.error(`Form query error for ${team}:`, error.message);
        return [];
      }

      return (data || [])
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

    const predictionsWithForm = await Promise.all(
      (todayMatches || []).map(async (match) => {
        const [homeForm, awayForm] = await Promise.all([
          getLastFiveForm(match.home_team_name, match.match_date),
          getLastFiveForm(match.away_team_name, match.match_date),
        ]);

        return {
          ...match,
          home_form: homeForm,
          away_form: awayForm,
        };
      })
    );

    const { data: finishedMatches, error: finishedError } = await supabase
      .from("predictions_history")
      .select("*")
      .eq("status", "FINISHED")
      .not("actual_home_goals", "is", null)
      .not("actual_away_goals", "is", null);

    if (finishedError) throw finishedError;

    const finished = finishedMatches || [];

    const overallStats = {
      total: finished.length,
      exact: finished.filter((m) => m.exact_hit).length,
      over: finished.filter((m) => m.over25_hit).length,
      btts: finished.filter((m) => m.btts_hit).length,
      winner: finished.filter((m) => m.winner_hit).length,
    };

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        match_day: today,
        predictions: predictionsWithForm,
        overall_stats: overallStats,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};