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

 const matches = await callFunction("sync-matches");
 const teamForm = await callFunction("sync-team-form");
 const predictions = await callFunction("sync-predictions");

 let training = null;
 const now = new Date();

 if (now.getUTCHours() === 2 && now.getUTCMinutes() === 5) {
 training = await callFunction("train-model");
 }

 console.log(" daily-sync kész", {
 matches,
 teamForm,
 predictions,
 training
 });

 return {
 statusCode: 200,
 body: JSON.stringify({
 ok: true,
 matches,
 teamForm,
 predictions,
 training
 })
 };
};

export const config = {
 schedule: "* * * * *"
};