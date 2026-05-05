exports.handler = async function (event) {
 try {
  if (event.httpMethod !== "POST") {
   return {
    statusCode: 405,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Csak POST kérés engedélyezett."
    })
   };
  }

  const adminToken = process.env.ADMIN_TOKEN;
  const requestToken =
   event.headers["x-admin-token"] ||
   event.headers["X-Admin-Token"] ||
   "";

  if (!adminToken) {
   return {
    statusCode: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Hiányzó ADMIN_TOKEN env változó."
    })
   };
  }

  if (requestToken !== adminToken) {
   return {
    statusCode: 401,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Nincs jogosultság."
    })
   };
  }

  const body = JSON.parse(event.body || "{}");
  const target = body.target;

  const allowedFunctions = new Set([
   "sync-matches",
   "sync-team-form",
   "sync-predictions",
   "sync-results",
   "train-model"
  ]);

  if (!allowedFunctions.has(target)) {
   return {
    statusCode: 400,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Nem engedélyezett function.",
     target
    })
   };
  }

  const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;

  if (!baseUrl) {
   return {
    statusCode: 500,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     error: "Hiányzik a URL vagy DEPLOY_PRIME_URL env."
    })
   };
  }

  const response = await fetch(`${baseUrl}/.netlify/functions/${target}`);
  const text = await response.text();

  let json;
  try {
   json = JSON.parse(text);
  } catch {
   json = text;
  }

  return {
   statusCode: response.ok ? 200 : 500,
   headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
   },
   body: JSON.stringify({
    ok: response.ok,
    target,
    status: response.status,
    result: json
   })
  };
 } catch (error) {
  return {
   statusCode: 500,
   headers: {
    "content-type": "application/json",
    "cache-control": "no-store"
   },
   body: JSON.stringify({
    error: error.message || "Ismeretlen hiba"
   })
  };
 }
};