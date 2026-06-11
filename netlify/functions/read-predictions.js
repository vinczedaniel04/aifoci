const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store"
        },
        body: JSON.stringify({
          error: "Hiányzó SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY"
        })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    function getLogicalDates() {
      const now = new Date();
      // Levonunk 6 órát a "logikai" naphoz
      const logicalNow = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      const todayStr = `${logicalNow.getUTCFullYear()}-${String(logicalNow.getUTCMonth() + 1).padStart(2, "0")}-${String(logicalNow.getUTCDate()).padStart(2, "0")}`;

      // Létrehozunk tökéletes Date objektumokat, amikből a gép hajszálpontos ISO stringet csinál
      const startOfDay = new Date(`${todayStr}T00:00:00Z`);
      const endOfDay = new Date(startOfDay.getTime() + 30 * 60 * 60 * 1000); // Éjfél + 30 óra (másnap reggel 6:00)

      return { 
        todayStr, 
        startIso: startOfDay.toISOString(), 
        endIso: endOfDay.toISOString() 
      };
    }

    const { todayStr, startIso, endIso } = getLogicalDates();

    const { data: predictions, error: predictionsError } = await supabase
      .from("predictions_history")
      .select("*")
      .gte("match_date", startIso)
      .lte("match_date", endIso)
      .order("match_date", { ascending: true });

    if (predictionsError) throw predictionsError;

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
      exact: finished.filter((m) => m.exact_hit === true).length,
      over: finished.filter((m) => m.over25_hit === true).length,
      btts: finished.filter((m) => m.btts_hit === true).length,
      winner: finished.filter((m) => m.winner_hit === true).length
    };

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      },
      body: JSON.stringify({
        ok: true,
        match_day: todayStr,
        predictions: predictions || [],
        overall_stats: overallStats
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      },
      body: JSON.stringify({
        error: err.message || "Ismeretlen hiba"
      })
    };
  }
};