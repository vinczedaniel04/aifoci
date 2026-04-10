import { createClient } from "@supabase/supabase-js";

function getBudapestTimeParts() {
 const parts = new Intl.DateTimeFormat("en-GB", {
 timeZone: "Europe/Budapest",
 hour: "2-digit",
 minute: "2-digit",
 hour12: false
 }).formatToParts(new Date());

 const map = {};
 for (const part of parts) {
 map[part.type] = part.value;
 }

 return {
 hour: Number(map.hour || 0),
 minute: Number(map.minute || 0)
 };
}

function getTodayUtcDate() {
 const now = new Date();
 return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
 now.getUTCDate()
 ).padStart(2, "0")}`;
}

export default async () => {
 const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

 if (!baseUrl) {
 throw new Error("Hiányzik a URL vagy DEPLOY_PRIME_URL env.");
 }

 if (!supabaseUrl || !supabaseKey) {
 throw new Error("Hiányzik a SUPABASE_URL vagy SUPABASE_SERVICE_ROLE_KEY env.");
 }

 const supabase = createClient(supabaseUrl, supabaseKey);

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

 const { hour, minute } = getBudapestTimeParts();
 const todayUtc = getTodayUtcDate();

 const startOfDay = `${todayUtc}T00:00:00.000Z`;
 const endOfDay = `${todayUtc}T23:59:59.999Z`;

 const { data: todayMatches, error: todayMatchesError } = await supabase
 .from("matches")
 .select("status, match_date")
 .gte("match_date", startOfDay)
 .lte("match_date", endOfDay);

 if (todayMatchesError) {
 throw todayMatchesError;
 }

 const rows = todayMatches || [];
 const hasLive = rows.some((x) =>
 ["LIVE", "IN_PLAY", "PAUSED"].includes((x.status || "").toUpperCase())
 );
 const hasUpcoming = rows.some((x) =>
 ["TIMED", "SCHEDULED"].includes((x.status || "").toUpperCase())
 );

 const isBeforeMidnightWindow = hour === 23 && minute >= 45;
 const isAfterMidnightWindow = hour === 0 && minute <= 20;
 const isMorningWindow = hour >= 6 && hour <= 9;

 const shouldRefreshListWindow =
 (isBeforeMidnightWindow || isAfterMidnightWindow || isMorningWindow) &&
 minute % 10 === 0;

 const shouldSyncMatches =
 hasLive ||
 shouldRefreshListWindow ||
 rows.length === 0;

 const shouldSyncTeamForm =
 !hasLive &&
 hasUpcoming &&
 minute % 10 === 0;

 const shouldSyncPredictions =
 hasLive ||
 shouldSyncMatches ||
 shouldSyncTeamForm ||
 (hasUpcoming && minute % 10 === 0);

 console.log(" daily-sync indul", {
 budapestHour: hour,
 budapestMinute: minute,
 hasLive,
 hasUpcoming,
 todayCount: rows.length,
 shouldSyncMatches,
 shouldSyncTeamForm,
 shouldSyncPredictions
 });

 let matches = null;
 let teamForm = null;
 let predictions = null;
 let training = null;

 if (shouldSyncMatches) {
 matches = await callFunction("sync-matches");
 }

 if (shouldSyncTeamForm) {
 teamForm = await callFunction("sync-team-form");
 }

 if (shouldSyncPredictions) {
 predictions = await callFunction("sync-predictions");
 }

 if (hour === 4 && minute === 5) {
 training = await callFunction("train-model");
 }

 console.log(" daily-sync kész", {
 matches,
 teamForm,
 predictions,
 training
 });

 return new Response(
 JSON.stringify({
 ok: true,
 matches,
 teamForm,
 predictions,
 training
 }),
 {
 status: 200,
 headers: {
 "content-type": "application/json"
 }
 }
 );
};

export const config = {
 schedule: "* * * * *"
};