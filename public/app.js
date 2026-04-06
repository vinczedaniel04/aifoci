const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const reloadBtn = document.getElementById("reloadBtn");

const CACHE_KEY = "foci_predictions_cache";
const CACHE_TIME = 5 * 60 * 1000;
const OPEN_LEAGUES_KEY = "foci_open_leagues";
const OPEN_MATCHES_KEY = "foci_open_matches";

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
 const status = (item.status || "").toUpperCase();
 if (status !== "FINISHED") return;

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
 const status = (item.status || "").toUpperCase();

 if (status === "FINISHED") {
 return `
 <div class="finished-badge">
 LEJÁTSZVA
 </div>
 `;
 }

 if (status === "LIVE" || status === "IN_PLAY" || status === "PAUSED") {
 return `
 <div class="live-badge">
 <span class="live-dot"></span>
 ÉLŐ
 </div>
 `;
 }

 if (status === "SCHEDULED" || status === "TIMED") {
 return `
 <div class="scheduled-badge">
 KÖZELGŐ
 </div>
 `;
 }

 return `
 <div class="started-badge">
 <span class="live-dot"></span>
 ELKEZDŐDÖTT
 </div>
 `;
}

function getFinishedAnalysis(item) {
 const status = (item.status || "").toUpperCase();
 if (status !== "FINISHED") return "";

 const home = item.actual_home_goals;
 const away = item.actual_away_goals;

 if (home == null || away == null) return "";

 const actualScore = `${home}-${away}`;

 return `
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
 <strong>${item.exact_hit ? "IGEN" : "NEM"}</strong>
 </div>
 <div class="box">
 <span class="label">Over 2.5 találat</span>
 <strong>${item.over25_hit ? "IGEN" : "NEM"}</strong>
 </div>
 <div class="box">
 <span class="label">BTTS találat</span>
 <strong>${item.btts_hit ? "IGEN" : "NEM"}</strong>
 </div>
 <div class="box">
 <span class="label">Összgól</span>
 <strong>${home + away}</strong>
 </div>
 </div>
 `;
}

function createToggleSection(title, innerHtml) {
 if (!innerHtml) return "";

 const sectionId = `toggle-${Math.random().toString(36).slice(2, 10)}`;

 return `
 <div class="toggle-area">
 <button class="toggle-btn" type="button" data-toggle-target="${sectionId}">
 ${title}
 </button>
 <div class="toggle-content" id="${sectionId}">
 ${innerHtml}
 </div>
 </div>
 `;
}

function wireToggleButtons(rootEl) {
 const buttons = rootEl.querySelectorAll("[data-toggle-target]");

 buttons.forEach((btn) => {
 btn.addEventListener("click", (event) => {
 event.stopPropagation();

 const targetId = btn.getAttribute("data-toggle-target");
 const target = rootEl.querySelector(`#${targetId}`);
 if (!target) return;

 const isOpen = target.classList.contains("open");
 target.classList.toggle("open");

 btn.textContent = isOpen
 ? btn.textContent.replace("elrejtése", "megnyitása")
 : btn.textContent.replace("megnyitása", "elrejtése");
 });
 });
}

function loadOpenLeagues() {
 try {
 const raw = localStorage.getItem(OPEN_LEAGUES_KEY);
 return raw ? JSON.parse(raw) : {};
 } catch {
 return {};
 }
}

function saveOpenLeagues(state) {
 localStorage.setItem(OPEN_LEAGUES_KEY, JSON.stringify(state));
}

function loadOpenMatches() {
 try {
 const raw = localStorage.getItem(OPEN_MATCHES_KEY);
 return raw ? JSON.parse(raw) : {};
 } catch {
 return {};
 }
}

function saveOpenMatches(state) {
 localStorage.setItem(OPEN_MATCHES_KEY, JSON.stringify(state));
}

function createMatchCard(item) {
 const statusBadge = getMatchStatusBadge(item);

 const status = (item.status || "").toUpperCase();
 const isFinished = status === "FINISHED";
 const isLive = ["LIVE", "IN_PLAY", "PAUSED"].includes(status);

 const resultLine = isFinished
 ? `<div class="time"><b>Végeredmény:</b> ${item.actual_home_goals ?? 0} - ${item.actual_away_goals ?? 0}</div>`
 : `<div class="time">Kezdés: ${new Date(item.match_date).toLocaleString("hu-HU")}</div>`;

 const cornersTotal =
 item.predicted_corners_total != null ? item.predicted_corners_total : "-";
 const cardsTotal =
 item.predicted_cards_total != null ? item.predicted_cards_total : "-";

 const predictedOver25Text =
 Number(item.predicted_over25_probability || 0) >= 50 ? "2,5 FELETT" : "2,5 ALATT";

 const predictedBttsText =
 Number(item.predicted_btts_probability || 0) >= 50 ? "GG" : "NG";

 const homeGoals = isFinished
 ? (item.actual_home_goals ?? 0)
 : (item.live_home ?? 0);

 const awayGoals = isFinished
 ? (item.actual_away_goals ?? 0)
 : (item.live_away ?? 0);

 const showScore = isFinished || isLive;
 const minute =
 isLive && item.minute != null
 ? `${item.minute}'`
 : isLive
 ? "LIVE"
 : "";

 const matchKey = String(item.match_id);
 const openMatches = loadOpenMatches();
 const isOpen = !!openMatches[matchKey];

 const finishedAnalysisHtml = getFinishedAnalysis(item);
 const goalMatrixHtml = renderGoalMatrix(
 Number(item.predicted_home_goals || 0),
 Number(item.predicted_away_goals || 0)
 );

 const card = document.createElement("div");
 card.className = "card match-card";

 card.innerHTML = `
 <button class="match-header" type="button">
 <div class="match-header-top">
 ${statusBadge}
 <div class="chevron ${isOpen ? "open" : ""}">⌄</div>
 </div>

 <div class="teams-row">
 <div class="team-side">
 ${item.home_team_crest ? `<img src="${item.home_team_crest}" class="team-logo" alt="${item.home_team_name}">` : ""}
 <span class="team-name">${item.home_team_name}</span>
 ${showScore ? `<span class="team-score">${homeGoals}</span>` : ""}
 </div>

 <div class="vs-block">
 <div class="vs">vs</div>
 ${minute ? `<div class="match-minute">${minute}</div>` : ""}
 </div>

 <div class="team-side away-side">
 ${showScore ? `<span class="team-score">${awayGoals}</span>` : ""}
 <span class="team-name">${item.away_team_name}</span>
 ${item.away_team_crest ? `<img src="${item.away_team_crest}" class="team-logo" alt="${item.away_team_name}">` : ""}
 </div>
 </div>

 ${resultLine}
 </button>

 <div class="match-body ${isOpen ? "open" : ""}">
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
 <span class="label">Over 2.5 (%)</span>
 <strong>${item.predicted_over25_probability ?? "-"}%</strong>
 </div>

 <div class="box">
 <span class="label">BTTS (%)</span>
 <strong>${item.predicted_btts_probability ?? "-"}%</strong>
 </div>

 <div class="box highlight">
 <span class="label">AI tipp 2,5</span>
 <strong>${predictedOver25Text}</strong>
 </div>

 <div class="box highlight">
 <span class="label">AI tipp GG</span>
 <strong>${predictedBttsText}</strong>
 </div>

 <div class="box">
 <span class="label">Szögletek</span>
 <strong>${cornersTotal}</strong>
 </div>

 <div class="box">
 <span class="label">Lapok</span>
 <strong>${cardsTotal}</strong>
 </div>
 </div>

 <div class="explanation">${item.explanation || ""}</div>

 ${isFinished ? createToggleSection("AI ellenőrzés megnyitása", finishedAnalysisHtml) : ""}
 ${createToggleSection("Gólmátrix megnyitása", goalMatrixHtml)}
 </div>
 `;

 const headerBtn = card.querySelector(".match-header");
 const body = card.querySelector(".match-body");
 const chevron = card.querySelector(".chevron");

 headerBtn.addEventListener("click", () => {
 const nowOpen = body.classList.toggle("open");
 chevron.classList.toggle("open", nowOpen);

 const current = loadOpenMatches();
 current[matchKey] = nowOpen;
 saveOpenMatches(current);
 });

 wireToggleButtons(card);

 return card;
}

function createLeagueBlock(leagueName, items) {
 const openState = loadOpenLeagues();
 const isOpen = !!openState[leagueName];

 const liveCount = items.filter((x) =>
 ["LIVE", "IN_PLAY", "PAUSED"].includes((x.status || "").toUpperCase())
 ).length;

 const finishedCount = items.filter(
 (x) => (x.status || "").toUpperCase() === "FINISHED"
 ).length;

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

 <span class="league-meta">
 ${liveCount > 0 ? `<span class="league-live-pill">${liveCount} élő</span>` : ""}
 <span class="league-toggle-text">${items.length} meccs • ${finishedCount} lejátszva</span>
 <span class="chevron ${isOpen ? "open" : ""}">⌄</span>
 </span>
 `;

 const content = document.createElement("div");
 content.className = "league-content";

 if (isOpen) {
 content.classList.add("open");
 }

 for (const item of items) {
 content.appendChild(createMatchCard(item));
 }

 header.addEventListener("click", () => {
 content.classList.toggle("open");
 const nowOpen = content.classList.contains("open");

 const toggleText = header.querySelector(".league-toggle-text");
 if (toggleText) {
 toggleText.textContent = `${items.length} meccs • ${finishedCount} lejátszva`;
 }

 const chevron = header.querySelector(".chevron");
 if (chevron) {
 chevron.classList.toggle("open", nowOpen);
 }

 const currentState = loadOpenLeagues();
 currentState[leagueName] = nowOpen;
 saveOpenLeagues(currentState);
 });

 wrapper.appendChild(header);
 wrapper.appendChild(content);

 return wrapper;
}

function renderData(items) {
 const newList = document.createElement("div");

 if (!items.length) {
 statusEl.textContent = "Nincs predikció az adatbázisban.";
 listEl.innerHTML = "";
 return;
 }

 const stats = calculateStats(items);

 if (stats.finished > 0) {
 const statBox = document.createElement("div");
 statBox.className = "card top-stat-card";

 const overPct = ((stats.over / stats.finished) * 100).toFixed(0);
 const bttsPct = ((stats.btts / stats.finished) * 100).toFixed(0);
 const exactPct = ((stats.exact / stats.finished) * 100).toFixed(0);

 statBox.innerHTML = `
 <div class="top-stat-header">
 <div>
 <div class="top-stat-kicker">Napi összesítő</div>
 <div class="top-stat-title">AI teljesítmény</div>
 </div>
 <div class="top-stat-badge">${stats.finished} meccs</div>
 </div>

 <div class="top-stat-grid">
 <div class="top-mini-box">
 <span class="label">Pontos eredmény</span>
 <strong>${stats.exact}</strong>
 <small>${exactPct}%</small>
 </div>

 <div class="top-mini-box">
 <span class="label">Over 2.5</span>
 <strong>${stats.over}</strong>
 <small>${overPct}%</small>
 </div>

 <div class="top-mini-box">
 <span class="label">BTTS</span>
 <strong>${stats.btts}</strong>
 <small>${bttsPct}%</small>
 </div>
 </div>
 `;

 newList.appendChild(statBox);
 }

 const grouped = groupByLeague(items);
 const leagues = Object.keys(grouped);

 leagues.forEach((leagueName) => {
 const block = createLeagueBlock(leagueName, grouped[leagueName]);
 newList.appendChild(block);
 });

 listEl.replaceChildren(...newList.childNodes);
}

async function loadPredictions(forceRefresh = false, silent = false) {
 if (!silent) {
 statusEl.textContent = "Betöltés adatbázisból...";
 }

 try {
 if (!forceRefresh) {
 const cached = localStorage.getItem(CACHE_KEY);

 if (cached) {
 const parsed = JSON.parse(cached);

 if (Date.now() - parsed.time < CACHE_TIME) {
 renderData(parsed.data);
 if (!silent) {
 statusEl.textContent = "Cache-ből betöltve";
 }
 return parsed.data;
 }
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

 if (!silent) {
 statusEl.textContent = `Betöltve DB-ből: ${items.length} predikció`;
 }

 return items;
 } catch (error) {
 if (!silent) {
 statusEl.textContent = error.message || "Hiba történt.";
 }
 return [];
 }
}

reloadBtn.addEventListener("click", async () => {
 localStorage.removeItem(CACHE_KEY);
 await loadPredictions(true, false);
});

window.addEventListener("DOMContentLoaded", async () => {
 await loadPredictions(true, false);

 setInterval(() => {
 loadPredictions(true, true);
 }, 180000);
});