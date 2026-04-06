const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          error: "Hiányzó SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY"
        })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    function getTodayUtcDate() {
      const now = new Date();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
        now.getUTCDate()
      ).padStart(2, "0")}`;
    }

    const matchDay = getTodayUtcDate();

    function factorial(n) {
      if (n <= 1) return 1;
      let result = 1;
      for (let i = 2; i <= n; i += 1) result *= i;
      return result;
    }

    function poisson(lambda, k) {
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
    }

    function estimateCorners(expectedHomeGoals, expectedAwayGoals) {
      const totalExpectedGoals = expectedHomeGoals + expectedAwayGoals;
      const safeTotal = totalExpectedGoals <= 0 ? 0.1 : totalExpectedGoals;
      const baseCorners = 8.0;
      const totalCorners = baseCorners + totalExpectedGoals * 1.9;

      return {
        total: Number(totalCorners.toFixed(2)),
        home: Number((totalCorners * (expectedHomeGoals / safeTotal)).toFixed(2)),
        away: Number((totalCorners * (expectedAwayGoals / safeTotal)).toFixed(2))
      };
    }

    function estimateCards(expectedHomeGoals, expectedAwayGoals) {
      const totalExpectedGoals = expectedHomeGoals + expectedAwayGoals;
      const goalDiff = Math.abs(expectedHomeGoals - expectedAwayGoals);

      let totalCards = 3.6;

      if (goalDiff < 0.4) totalCards += 1.1;
      else if (goalDiff < 0.8) totalCards += 0.6;

      if (totalExpectedGoals < 2.2) totalCards += 0.8;
      else if (totalExpectedGoals > 3.2) totalCards -= 0.3;

      return {
        total: Number(totalCards.toFixed(2))
      };
    }

    function predictMatch(match, homeForm, awayForm) {
      const homeAttack =
        Number(homeForm.avg_goals_for_home ?? homeForm.avg_goals_for ?? 1.2);
      const homeDefense =
        Number(homeForm.avg_goals_against_home ?? homeForm.avg_goals_against ?? 1.2);

      const awayAttack =
        Number(awayForm.avg_goals_for_away ?? awayForm.avg_goals_for ?? 1.0);
      const awayDefense =
        Number(awayForm.avg_goals_against_away ?? awayForm.avg_goals_against ?? 1.0);

      const expectedHomeGoals = (homeAttack + awayDefense) / 2;
      const expectedAwayGoals = (awayAttack + homeDefense) / 2;

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

      const corners = estimateCorners(expectedHomeGoals, expectedAwayGoals);
      const cards = estimateCards(expectedHomeGoals, expectedAwayGoals);

      const strongerSide =
        expectedHomeGoals >= expectedAwayGoals
          ? match.home_team_name
          : match.away_team_name;

      return {
        predicted_score: bestScore,
        predicted_home_goals: Number(expectedHomeGoals.toFixed(2)),
        predicted_away_goals: Number(expectedAwayGoals.toFixed(2)),
        predicted_over25_probability: Number((over25 * 100).toFixed(2)),
        predicted_btts_probability: Number((btts * 100).toFixed(2)),
        predicted_corners_total: corners.total,
        predicted_cards_total: cards.total,
        explanation: `A modell a mai csapatok előző 5 meccséből számolt formaadatokat használja. A várható gólok alapján ${match.home_team_name} ${expectedHomeGoals.toFixed(
          2
        )}, ${match.away_team_name} ${expectedAwayGoals.toFixed(
          2
        )}. Enyhe fölényben van: ${strongerSide}.`
      };
    }

    const { data: matches, error: matchesError } = await supabase
      .from("matches")
      .select("*")
      .order("match_date", { ascending: true });

    if (matchesError) throw matchesError;

    const { data: formRows, error: formError } = await supabase
      .from("team_form_cache")
      .select("*")
      .eq("match_day", matchDay);

    if (formError) throw formError;

    const formMap = new Map();
    for (const row of formRows || []) {
      formMap.set(row.team_id, row);
    }

    const rows = (matches || []).map((match) => {
      const homeForm = formMap.get(match.home_team_id) || {
        avg_goals_for: 1.2,
        avg_goals_against: 1.2,
        avg_goals_for_home: 1.2,
        avg_goals_against_home: 1.2
      };

      const awayForm = formMap.get(match.away_team_id) || {
        avg_goals_for: 1.0,
        avg_goals_against: 1.0,
        avg_goals_for_away: 1.0,
        avg_goals_against_away: 1.0
      };

      const prediction = predictMatch(match, homeForm, awayForm);

      const hasActual =
        match.full_time_home != null && match.full_time_away != null;

      const actualTotal = hasActual
        ? match.full_time_home + match.full_time_away
        : null;

      const actualBtts = hasActual
        ? match.full_time_home > 0 && match.full_time_away > 0
        : null;

      const actualScore = hasActual
        ? `${match.full_time_home}-${match.full_time_away}`
        : null;

      return {
        match_id: match.match_id,
        match_date: match.match_date,
        competition_code: match.competition_code,
        competition_name: match.competition_name,
        home_team_name: match.home_team_name,
        away_team_name: match.away_team_name,
        home_team_crest: match.home_team_crest || null,
        away_team_crest: match.away_team_crest || null,
        competition_emblem: match.competition_emblem || null,

        predicted_score: prediction.predicted_score,
        predicted_home_goals: prediction.predicted_home_goals,
        predicted_away_goals: prediction.predicted_away_goals,
        predicted_over25_probability: prediction.predicted_over25_probability,
        predicted_btts_probability: prediction.predicted_btts_probability,
        predicted_corners_total: prediction.predicted_corners_total,
        predicted_cards_total: prediction.predicted_cards_total,
        explanation: prediction.explanation,

        actual_home_goals: match.full_time_home,
        actual_away_goals: match.full_time_away,
        exact_hit: hasActual ? prediction.predicted_score === actualScore : null,
        over25_hit: hasActual
          ? (prediction.predicted_over25_probability >= 50) === (actualTotal > 2.5)
          : null,
        btts_hit: hasActual
          ? (prediction.predicted_btts_probability >= 50) === actualBtts
          : null,

        updated_at: new Date().toISOString()
      };
    });

    const { error: upsertError } = await supabase
      .from("predictions_history")
      .upsert(rows, { onConflict: "match_id" });

    if (upsertError) throw upsertError;

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