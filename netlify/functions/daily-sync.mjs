export default async () => {
  const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;

  if (!baseUrl) {
    throw new Error("Hiányzik a URL vagy DEPLOY_PRIME_URL env.");
  }

  async function callFunction(name) {
    const url = `${baseUrl}/.netlify/functions/${name}`;

    const response = await fetch(url);
    const json = await response.json();

    if (!response.ok) {
      throw new Error(`${name} hiba: ${JSON.stringify(json)}`);
    }

    return json;
  }

  const matches = await callFunction("sync-matches");
  const teamForm = await callFunction("sync-team-form");
  const predictions = await callFunction("sync-predictions");

  console.log("daily-sync kész", {
    matches,
    teamForm,
    predictions
  });
};

export const config = {
  schedule: "*/15 * * * *"
};