export default async () => {
 const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;

 if (!baseUrl) {
 throw new Error("Hiányzik a URL vagy DEPLOY_PRIME_URL env.");
 }

 async function callFunction(name) {
 const url = `${baseUrl}/.netlify/functions/${name}`;

 try {
 const response = await fetch(url);
 const text = await response.text();

 let json;
 try {
 json = JSON.parse(text);
 } catch {
 json = text;
 }

 if (!response.ok) {
 throw new Error(`${name} hiba: ${text}`);
 }

 console.log(` ${name} OK`);
 return json;
 } catch (err) {
 console.error(` ${name} FAIL`, err.message);
 return null;
 }
 }

 console.log(" daily-sync indul");

 const now = new Date();
 const minute = now.getUTCMinutes();

 // Ha van élő meccs, mehet sűrűbben a meccsfrissítés
 let hasLive = false;

 try {
 const liveCheck = await fetch(`${baseUrl}/.netlify/functions/read-predictions`);
 const liveText = await liveCheck.text();

 let liveData;
 try {
 liveData = JSON.parse(liveText);
 } catch {
 liveData = {};
 }

 hasLive = (liveData.predictions || []).some((p) =>
 ["LIVE", "IN_PLAY", "PAUSED"].includes((p.status || "").toUpperCase())
 );

 console.log(" hasLive:", hasLive);
 } catch (err) {
 console.error(" live check fail", err.message);
 }

 // sync-matches:
 // - ha van live meccs: minden percben
 // - ha nincs: 3 percenként
 if (hasLive || minute % 3 === 0) {
 await callFunction("sync-matches");
 } else {
 console.log(" sync-matches skip");
 }

 // team form mehet mindig, mert már limitált batch-ben dolgozik
 await callFunction("sync-team-form");

 // predictions mindig mehet, DB alapú
 await callFunction("sync-predictions");

 console.log(" daily-sync kész");

 return new Response(JSON.stringify({ ok: true }), {
 status: 200,
 headers: {
 "content-type": "application/json"
 }
 });
};

export const config = {
 schedule: "* * * * *"
};