const { createClient } = require("@supabase/supabase-js");

exports.handler = async function () {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const footballToken = process.env.FOOTBALL_DATA_API_KEY;

    if (!supabaseUrl || !supabaseKey || !footballToken) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Hiányzó API kulcsok" })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const now = new Date();

    // 1. Megkeressük az adatbázisban azokat a meccseket, amik még nincsenek lezárva (nem FINISHED)
    const { data: pendingMatches, error: dbError } = await supabase
      .from("matches")
      .select("id, match_date, status")
      .neq("status", "FINISHED");

    if (dbError) throw dbError;

    // 2. Szűrés: Csak azokra a meccsekre figyelünk, amiknek a kezdése óta eltelt legalább 1 óra 50 perc (110 perc)
    const MATCH_DURATION_MS = 110 * 60 * 1000; // 1 óra 50 perc ezredmásodpercben

    const dueMatches = (pendingMatches || []).filter((m) => {
      const matchStartTime = new Date(m.match_date).getTime();
      const expectedEndTime = matchStartTime + MATCH_DURATION_MS;
      return now.getTime() >= expectedEndTime;
    });

    // Ha egyetlen meccs sem ért még véget a számítás szerint, leállunk API hívás nélkül
    if (dueMatches.length === 0) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          message: "Nincs mostanában lejárt frissítendő mérkőzés",
          updated_count: 0
        })
      };
    }

    // 3. Ha van várhatóan lezárult meccs, lekérjük az elmúlt 2 nap FINISHED meccseit az API-ból
    const past = new Date(now);
    past.setDate(past.getDate() - 2);

    const dateFrom = past.toISOString().split("T")[0];
    const dateTo = now.toISOString().split("T")[0];

    const response = await fetch(
      `https://api.football-data.org/v4/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      {
        headers: { "X-Auth-Token": footballToken }
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API hiba: ${response.status} ${text}`);
    }

    const data = await response.json();
    const finishedMatches = data.matches || [];

    if (finishedMatches.length === 0) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, message: "Az API-ban még nem jelentek meg a végeredmények", updated_count: 0 })
      };
    }

    // 4. Eredmények frissítése a Supabase-ben
    const updates = finishedMatches.map((m) => ({
      id: m.id,
      status: "FINISHED",
      score_home: m.score?.fullTime?.home ?? null,
      score_away: m.score?.fullTime?.away ?? null,
      updated_at: new Date().toISOString()
    }));

    const { error: upsertError } = await supabase
      .from("matches")
      .upsert(updates, { onConflict: "id" });

    if (upsertError) throw upsertError;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        message: "Végeredmények sikeresen frissítve",
        updated_count: updates.length
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error.message || "Ismeretlen hiba" })
    };
  }
};