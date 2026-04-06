export default async () => {
 const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;

 async function call(name) {
 try {
 const res = await fetch(`${baseUrl}/.netlify/functions/${name}`);
 console.log(` ${name}`);
 return await res.json();
 } catch (e) {
 console.log(` ${name}`, e.message);
 return null;
 }
 }

 console.log(" daily-sync indul");

 // VAN-E LIVE MECCS?
 const liveCheck = await fetch(`${baseUrl}/.netlify/functions/read-predictions`);
 const liveData = await liveCheck.json();

 const hasLive = (liveData.predictions || []).some(p =>
 ["LIVE", "IN_PLAY"].includes((p.status || "").toUpperCase())
 );

 console.log("LIVE meccs:", hasLive);

 const now = new Date();
 const minute = now.getUTCMinutes();

 // MATCHES LOGIKA
 if (hasLive) {
 // ha live van → minden percben
 await call("sync-matches");
 } else {
 // ha nincs → 3 percenként
 if (minute % 3 === 0) {
 await call("sync-matches");
 } else {
 console.log(" sync-matches skip");
 }
 }

 // ezek mindig mehetnek
 await call("sync-team-form");
 await call("sync-predictions");

 console.log(" kész");

 return {
 statusCode: 200,
 body: JSON.stringify({ ok: true })
 };
};

export const config = {
 schedule: "* * * * *"
};