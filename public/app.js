const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const reloadBtn = document.getElementById("reloadBtn");

const CACHE_KEY = "foci_predictions_cache";
const CACHE_TIME = 5 * 60 * 1000;

function factorial(n) {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function buildGoalMatrix(expectedHomeGoals, expectedAwayGoals) {
  const matrix = [];
  let maxProbability = 0;
  let topCell = "0-0";

  for (let home = 0; home <= 4; home += 1) {
    const row = [];
    for (let away = 0; away <= 4; away += 1) {
      const probability =
        poisson(expectedHomeGoals, home) * poisson(expectedAwayGoals, away);
      const percent = Number((probability * 100).toFixed(1));

      if (percent > maxProbability) {
        maxProbability = percent;
        topCell = `${home}-${away}`;
      }

      row.push({
        home,
        away,
        percent
      });
    }
    matrix.push(row);
  }

  return { matrix, topCell };
}

function renderGoalMatrix(expectedHomeGoals, expectedAwayGoals) {
  const { matrix, topCell } = buildGoalMatrix(
    expectedHomeGoals,
    expectedAwayGoals
  );

  let html = `
    <div class="matrix-wrap">
      <div class="matrix-title">Gólmátrix (0–4 gól)</div>
      <table class="matrix-table">
        <thead>
          <tr>
            <th>Hazai \\ Vendég</th>
            <th>0</th>
            <th>1</th>
            <th>2</th>
            <th>3</th>
            <th>4</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (let home = 0; home < matrix.length; home += 1) {
    html += `<tr><th>${home}</th>`;
    for (let away = 0; away < matrix[home].length; away += 1) {
      const cell = matrix[home][away];
      const score = `${cell.home}-${cell.away}`;
      const topClass = score === topCell ? "top-prob" : "";
      html += `<td class="${topClass}">${cell.percent}%</td>`;
    }
    html += `</tr>`;
  }

  html += `
        </tbody>
      </table>
      <div class="matrix-note">A pirossal jelölt cella a legvalószínűbb pontos eredmény.</div>
    </div>
  `;

  return html;
}

function groupByLeague(items) {
  const grouped = {};

  for (const item of items) {
    const key = `${item.competition_name} (${item.competition_code})`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }

  return grouped;
}

function calculateStats(items) {
  let finished = 0;
  let exact = 0;
  let over = 0;
  let btts = 0;

  items.forEach((item) => {
    const home = item.actual_home_goals;
    const away = item.actual_away_goals;

    if (home == null || away == null) return;

    finished++;

    if (item.exact_hit === true) exact++;
    if (item.over25_hit === true) over++;
    if (item.btts_hit === true) btts++;
  });

  return {
    finished,
    exact,
    over,
    btts
  };
}

function getMatchStatusBadge(item) {
  const hasFinalScore =
    item.actual_home_goals != null && item.actual_away_goals != null;

  if (hasFinalScore) {
    return `
      <div class="finished-badge">
        ✅ LEJÁTSZVA
      </div>
    `;
  }

  const matchTime = new Date(item.match_date).getTime();
  const now = Date.now();

  if (matchTime < now) {
    return `
      <div class="started-badge">
        <span class="live-dot"></span>
        ELKEZDŐDÖTT
      </div>
    `;
  }

  return `
    <div class="scheduled-badge">
      🕒 KÖZELGŐ
    </div>
  `;
}

function getFinishedAnalysis(item) {
  const home = item.actual_home_goals;
  const away = item.actual_away_goals;

  if (home == null || away == null) return "";

  const actualScore = `${home}-${away}`;

  return `
    <div class="matrix-wrap">
      <div class="matrix-title">AI ellenőrzés</div>
      <div class="grid">
        <div class="box">
          <span class="label">Valós végeredmény</span>
          <strong>${actualScore}</strong>
        </div>
        <div class="box">
          <span class="label">AI tipp</span>
          <strong>${item.predicted_score || "-"}</strong>
        </div>
        <div class="box">
          <span class="label">Pontos eredmény</span>
          <strong>${item.exact_hit ? "✅ IGEN" : "❌ NEM"}</strong>
        </div>
        <div class="box">
          <span class="label">Over 2.5 találat</span>
          <strong>${item.over25_hit ? "✅ IGEN" : "❌ NEM"}</strong>
        </div>
        <div class="box">
          <span class="label">BTTS találat</span>
          <strong>${item.btts_hit ? "✅ IGEN" : "❌ NEM"}</strong>
        </div>
        <div class="box">
          <span class="label">Összgól</span>
          <strong>${home + away}</strong>
        </div>
      </div>
    </div>
  `;
}

function createMatchCard(item) {
  const statusBadge = getMatchStatusBadge(item);

  const hasFinalScore =
    item.actual_home_goals != null && item.actual_away_goals != null;

  const resultLine = hasFinalScore
    ? `<div class="time"><b>Végeredmény:</b> ${item.actual_home_goals} - ${item.actual_away_goals}</div>`
    : `<div class="time">Kezdés: ${new Date(item.match_date).toLocaleString("hu-HU")}</div>`;

  const cornersTotal =
    item.predicted_corners_total != null ? item.predicted_corners_total : "-";
  const cardsTotal =
    item.predicted_cards_total != null ? item.predicted_cards_total : "-";

  const card = document.createElement("div");
  card.className = "card";

  card.innerHTML = `
    ${statusBadge}
    <div class="teams-row">
    <div class="team-side">
      ${item.home_team_crest ? `<img src="${item.home_team_crest}" class="team-logo">`: ""}
       <span>${item.home_team_name}</span>
    </div>

    <div class="vs">vs</div>

    <div class="team-side away-side">
    <span> ${item.away_team_name}</span>
    ${item.away_team_crest ? `<img src="${item.away_team_crest}" class="team-logo"> `: ""}
    </div>
    </div>
    ${resultLine}

    <div class="grid">
      <div class="box">
        <span class="label">Legvalószínűbb eredmény</span>
        <strong>${item.predicted_score || "-"}</strong>
      </div>

      <div class="box">
        <span class="label">Várható gólok</span>
        <strong>${item.predicted_home_goals ?? "-"} - ${item.predicted_away_goals ?? "-"}</strong>
      </div>

      <div class="box">
        <span class="label">Over 2.5</span>
        <strong>${item.predicted_over25_probability ?? "-"}%</strong>
      </div>

      <div class="box">
        <span class="label">BTTS</span>
        <strong>${item.predicted_btts_probability ?? "-"}%</strong>
      </div>

      <div class="box">
        <span class="label">Szögletek (AI)</span>
        <strong>${cornersTotal}</strong>
      </div>

      <div class="box">
        <span class="label">Sárgalapok (AI)</span>
        <strong>${cardsTotal}</strong>
      </div>
    </div>

    <div class="explanation">${item.explanation || ""}</div>

    ${getFinishedAnalysis(item)}

    ${renderGoalMatrix(
      Number(item.predicted_home_goals || 0),
      Number(item.predicted_away_goals || 0)
    )}
  `;

  return card;
}

function createLeagueBlock(leagueName, items, isOpen = false) {
 const wrapper = document.createElement("section");
 wrapper.className = "league-block";

 const header = document.createElement("button");
 header.className = "league-header";

 const emblem = items[0]?.competition_emblem || "";

 header.innerHTML = `
 <span class="league-title-wrap">
 ${emblem ? `<img src="${emblem}" class="league-logo" alt="${leagueName}">` : ""}
 <span>${leagueName}</span>
 </span>
 <span class="league-toggle-text">${items.length} meccs • lenyitás</span>
 `;

 const content = document.createElement("div");
 content.className = "league-content";

 if (isOpen) {
 content.classList.add("open");
 const toggleText = header.querySelector(".league-toggle-text");
 if (toggleText) {
 toggleText.textContent = `${items.length} meccs • összecsukás`;
 }
 }

 for (const item of items) {
 content.appendChild(createMatchCard(item));
 }

 header.addEventListener("click", () => {
 content.classList.toggle("open");
 const toggleText = header.querySelector(".league-toggle-text");
 if (toggleText) {
 toggleText.textContent = content.classList.contains("open")
 ? `${items.length} meccs • összecsukás`
 : `${items.length} meccs • lenyitás`;
 }
 });

 wrapper.appendChild(header);
 wrapper.appendChild(content);

 return wrapper;
}

function renderData(items) {
  listEl.innerHTML = "";

  if (!items.length) {
    statusEl.textContent = "Nincs predikció az adatbázisban.";
    return;
  }

  const stats = calculateStats(items);

  if (stats.finished > 0) {
    const statBox = document.createElement("div");
    statBox.className = "card";

    const overPct = ((stats.over / stats.finished) * 100).toFixed(0);
    const bttsPct = ((stats.btts / stats.finished) * 100).toFixed(0);
    const exactPct = ((stats.exact / stats.finished) * 100).toFixed(0);

    statBox.innerHTML = `
      <div class="teams">📊 AI napi teljesítmény</div>

      <div class="grid">
        <div class="box">
          <span class="label">Lejátszott meccsek</span>
          <strong>${stats.finished}</strong>
        </div>

        <div class="box">
          <span class="label">Pontos eredmény</span>
          <strong>${stats.exact} (${exactPct}%)</strong>
        </div>

        <div class="box">
          <span class="label">Over 2.5 találat</span>
          <strong>${stats.over} (${overPct}%)</strong>
        </div>

        <div class="box">
          <span class="label">BTTS találat</span>
          <strong>${stats.btts} (${bttsPct}%)</strong>
        </div>
      </div>
    `;

    listEl.appendChild(statBox);
  }

  const grouped = groupByLeague(items);
  const leagues = Object.keys(grouped);

  leagues.forEach((leagueName) => {
    const block = createLeagueBlock(leagueName, grouped[leagueName], false);
    listEl.appendChild(block);
  });
}

async function loadPredictions() {
  statusEl.textContent = "Betöltés adatbázisból...";
  listEl.innerHTML = "";

  try {
    const cached = localStorage.getItem(CACHE_KEY);

    if (cached) {
      const parsed = JSON.parse(cached);

      if (Date.now() - parsed.time < CACHE_TIME) {
        renderData(parsed.data);
        statusEl.textContent = "Cache-ből betöltve";
        return;
      }
    }

    const response = await fetch("/.netlify/functions/read-predictions");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Szerverhiba");
    }

    const items = data.predictions || [];

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        time: Date.now(),
        data: items
      })
    );

    renderData(items);
    statusEl.textContent = `Betöltve DB-ből: ${items.length} predikció`;
  } catch (error) {
    statusEl.textContent = error.message || "Hiba történt.";
  }
}

reloadBtn.addEventListener("click", loadPredictions);
window.addEventListener("DOMContentLoaded", loadPredictions);