exports.handler = async function(event, context) {
  try {
    // A Sofascore élő meccseket lekérő belső linkje
    const url = "https://api.sofascore.com/api/v1/sport/football/events/live";
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.sofascore.com",
        "Referer": "https://www.sofascore.com/"
      }
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          success: false,
          status: response.status,
          message: "A Sofascore blokkolta a kérést! (Valószínűleg Cloudflare 403 Forbidden)",
        })
      };
    }

    const data = await response.json();
    
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Siker! A Netlify átjutott a védelmen!",
        live_matches_found: data.events ? data.events.length : 0
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};