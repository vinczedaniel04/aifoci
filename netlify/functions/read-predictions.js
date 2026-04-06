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

    const { data, error } = await supabase
      .from("predictions_history")
      .select("*")
      .order("match_date", { ascending: true });

    if (error) throw error;

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ok: true,
        predictions: data || []
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