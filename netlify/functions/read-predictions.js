const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ error: "Hiányzó kulcsok" })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Kiszámoljuk a logikai napot
    const now = new Date();
    const logicalNow = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    
    const ty = logicalNow.getUTCFullYear();
    const tm = String(logicalNow.getUTCMonth() + 1).padStart(2, "0");
    const td = String(logicalNow.getUTCDate()).padStart(2, "0");
    const todayStr = `${ty}-${tm}-${td}`;

    const tomorrow = new Date(logicalNow.getTime() + 24 * 60 * 60 * 1000);
    const tomy = tomorrow.getUTCFullYear();
    const tomm = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
    const tomd = String(tomorrow.getUTCDate()).padStart(2, "0");
    const tomorrowStr = `${tomy}-${tomm}-${tomd}`;

    // A JS számára a pontos, szigorú határok ISO formátumban:
    const startLimit = `${todayStr}T00:00:00.000Z`;
    const endLimit = `${tomorrowStr}T06:00:00.000Z`;

    // 2. GOLYÓÁLLÓ LEKÉRÉS: Lekérünk mindent tegnaptól holnapig
    const safeStart = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const safeEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    
    const { data: allPredictions, error: predictionsError } = await supabase
      .from("predictions_history")
      .select("*")
      .gte("match_date", safeStart)
      .lte("match_date", safeEnd)
      .order("match_date", { ascending: true });

    if (predictionsError) throw predictionsError;

    // 3. Szigorú JS oldali szűrés: Ez 100%-os biztonsággal kiválogatja a megfelelő időablakot
    const todayPredictions = (allPredictions || []).filter(p => {
      return p.match_date >= startLimit && p.match_date <= endLimit;
    });

    // 4. Overall stats lekérése
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
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({
        ok: true,
        match_day: todayStr,
        predictions: todayPredictions,
        overall_stats: overallStats
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({ error: err.message || "Ismeretlen hiba" })
    };
  }
};