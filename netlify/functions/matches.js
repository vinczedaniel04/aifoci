exports.handler = async function () {
  try {
    const token = process.env.FOOTBALL_DATA_API_KEY;

    if (!token) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "FOOTBALL_DATA_API_KEY nincs beállítva."
        })
      };
    }

    const API_BASE = "https://api.football-data.org/v4";
    const COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1"];

    async function fetchCompetitionMatches(code) {
      const url = `${API_BASE}/competitions/${code}/matches?status=SCHEDULED`;

      const response = await fetch(url, {
        headers: {
          "X-Auth-Token": token
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`football-data hiba (${code}): ${response.status} ${text}`);
      }

      const data = await response.json();
      return data.matches || [];
    }

    const results = await Promise.all(
      COMPETITIONS.map((code) => fetchCompetitionMatches(code))
    );

    const matches = results
      .flat()
      .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
      .slice(0, 80)
      .map((m) => ({
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
        }
      }));

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300"
      },
      body: JSON.stringify({ matches })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || "Ismeretlen hiba"
      })
    };
  }
};