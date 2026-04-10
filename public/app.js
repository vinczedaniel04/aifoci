const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const aiStatsEl = document.getElementById("ai-stats");

const CACHE_KEY = "foci_predictions_cache";
const CACHE_TIME = 60 * 1000;
const OPEN_LEAGUES_KEY = "foci_open_leagues";
const OPEN_MATCHES_KEY = "foci_open_matches";
const OPEN_STATS_KEY = "foci_stats_open";

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

 row.push({ home, away, percent });
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
 <div class="matrix-note">A piros cella a legvalószínűbb pontos eredmény.</div>
 </div>
 `;

 return html;
}

function formatCompetitionName(code, fallback) {
 const map = {
 CL: "Bajnokok Ligája",
 PL: "Premier League",
 PD: "La Liga",
 BL1: "Bundesliga",
 SA: "Serie A",
 FL1: "Ligue 1",
 PPL: "Primeira Liga",
 DED: "Eredivisie",
 ELC: "Championship",
 BSA: "Brazil Serie A"
 };

 return map[code] || fallback || code;
}

function groupByLeague(items) {
 const grouped = {};

 for (const item of items) {
 const key = item.competition_code || item.competition_name;
 if (!grouped[key]) {
 grouped[key] = {
 code: item.competition_code,
 name: formatCompetitionName(item.competition_code, item.competition_name),
 emblem: item.competition_emblem || "",
 items: []
 };
 }
 grouped[key].items.push(item);
 }

 return grouped;
}

function getMatchStatusBadge(item) {
 const status = (item.status || "").toUpperCase();

 if (status === "FINISHED") {
 return `<div class="finished-badge">LEJÁTSZVA</div>`;
 }

 if (status === "LIVE" || status === "IN_PLAY" || status === "PAUSED") {
 return `
 <div class="live-badge">
 <span class="live-dot"></span>
 ÉLŐ
 </div>
 `;
 }

 return `<div class="scheduled-badge">KÖZELGŐ</div>`;
}

function createToggleSection(title, innerHtml) {
 const sectionId = `toggle-${Math.random().toString(36).slice(2, 10)}`;

 return `
 <div class="toggle-area">
 <button class="toggle-btn" type="button" data-toggle-target="${sectionId}">
 <span>${title}</span>
 <span class="arrow small"></span>
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

 const arrow = btn.querySelector(".arrow");
 if (arrow) {
 arrow.classList.toggle("open", !isOpen);
 }
 });
 });
}

function loadOpenState(key) {
 try {
 const raw = localStorage.getItem(key);
 return raw ? JSON.parse(raw) : {};
 } catch {
 return {};
 }
}

function saveOpenState(key, state) {
 localStorage.setItem(key, JSON.stringify(state));
}

function getMarketToneStyle(value) {
const percent = Number(value || 0);

if (percent >= 50) {
return `
background: linear-gradient(135deg, rgba(34, 197, 94, 0.22) 0%, rgba(59, 130, 246, 0.18) 55%, #050a12 100%);
border-color: rgba(74, 222, 128, 0.45);
box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.12);
`;
}

if (percent < 30) {
return `
background: linear-gradient(135deg, rgba(239, 68, 68, 0.20) 0%, rgba(59, 130, 246, 0.14) 55%, #050a12 100%);
border-color: rgba(248, 113, 113, 0.35);
box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.10);
`;
}

return `
background: linear-gradient(135deg, rgba(250, 204, 21, 0.18) 0%, rgba(59, 130, 246, 0.14) 55%, #050a12 100%);
border-color: rgba(250, 204, 21, 0.30);
box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.08);
`;
}

function render1X2Row(item) {
const home = Number(item.predicted_home_win_probability || 0);
const draw = Number(item.predicted_draw_probability || 0);
const away = Number(item.predicted_away_win_probability || 0);
const max = Math.max(home, draw, away);

const homeStyle = getMarketToneStyle(home);
const drawStyle = getMarketToneStyle(draw);
const awayStyle = getMarketToneStyle(away);

return `
<div class="market-row">
<div class="market-pill ${home === max ? "active" : ""}" style="${homeStyle}">
<div class="market-left">
${
item.home_team_crest
? `<img src="${item.home_team_crest}" class="market-logo" alt="${item.home_team_name}">`
: `<span class="market-short">1</span>`
}
</div>
<div class="market-right">${home.toFixed(0)}%</div>
</div>

<div class="market-pill draw ${draw === max ? "active" : ""}" style="${drawStyle}">
<div class="market-left">X</div>
<div class="market-right">${draw.toFixed(0)}%</div>
</div>

<div class="market-pill ${away === max ? "active" : ""}" style="${awayStyle}">
<div class="market-left">
${
item.away_team_crest
? `<img src="${item.away_team_crest}" class="market-logo" alt="${item.away_team_name}">`
: `<span class="market-short">2</span>`
}
</div>
<div class="market-right">${away.toFixed(0)}%</div>
</div>
</div>
`;
}


function createMatchCard(item) {
 const statusBadge = getMatchStatusBadge(item);

 const status = (item.status || "").toUpperCase();
 const isFinished = status === "FINISHED";
 const isLive = ["LIVE", "IN_PLAY", "PAUSED"].includes(status);

 const resultLine = isFinished
 ? `<div class="time"><b>Végeredmény:</b> ${item.actual_home_goals ?? 0} - ${item.actual_away_goals ?? 0}</div>`
 : `<div class="time">Kezdés: ${new Date(item.match_date).toLocaleString("hu-HU")}</div>`;

 const homeGoals = isFinished ? (item.actual_home_goals ?? 0) : (item.live_home ?? 0);
 const awayGoals = isFinished ? (item.actual_away_goals ?? 0) : (item.live_away ?? 0);
 const showScore = isFinished || isLive;

 const totalGoals = (
 Number(item.predicted_home_goals || 0) + Number(item.predicted_away_goals || 0)
 ).toFixed(2);

 const bttsText = item.final_btts_tip === "IGEN" ? "Igen" : "Nem";

 const detailHtml = `
 <div class="detail-grid">
 <div class="detail-box">
 <span class="label">Legvalószínűbb eredmény</span>
 <strong>${item.predicted_score || "-"}</strong>
 </div>
 <div class="detail-box">
 <span class="label">Hazai győzelem</span>
 <strong>${item.predicted_home_win_probability ?? "-"}%</strong>
 </div>
 <div class="detail-box">
 <span class="label">Döntetlen</span>
 <strong>${item.predicted_draw_probability ?? "-"}%</strong>
 </div>
 <div class="detail-box">
 <span class="label">Vendég győzelem</span>
 <strong>${item.predicted_away_win_probability ?? "-"}%</strong>
 </div>
 <div class="detail-box">
 <span class="label">Over 2.5 valószínűség</span>
 <strong>${item.predicted_over25_probability ?? "-"}%</strong>
 </div>
 <div class="detail-box">
 <span class="label">Mindkét csapat gól valószínűség</span>
 <strong>${item.predicted_btts_probability ?? "-"}%</strong>
 </div>
 <div class="detail-box">
 <span class="label">Szögletek</span>
 <strong>${item.predicted_corners_total ?? "-"}</strong>
 </div>
 <div class="detail-box">
 <span class="label">Lapok</span>
 <strong>${item.predicted_cards_total ?? "-"}</strong>
 </div>
 </div>
 <div class="explanation">${item.explanation || ""}</div>
 `;

 const goalMatrixHtml = renderGoalMatrix(
 Number(item.predicted_home_goals || 0),
 Number(item.predicted_away_goals || 0)
 );

 const matchKey = String(item.match_id);
 const openMatches = loadOpenState(OPEN_MATCHES_KEY);
 const isOpen = !!openMatches[matchKey];

 const card = document.createElement("div");
 card.className = "card match-card";

 card.innerHTML = `
 <button class="match-header" type="button">
 <div class="match-header-top">
 ${statusBadge}
 <span class="arrow ${isOpen ? "open" : ""}"></span>
 </div>

 <div class="teams-row">
 <div class="team-side">
 ${
 item.home_team_crest
 ? `<img src="${item.home_team_crest}" class="team-logo" alt="${item.home_team_name}">`
 : ""
 }
 <span class="team-name">${item.home_team_name}</span>
 ${showScore ? `<span class="team-score">${homeGoals}</span>` : ""}
 </div>

 <div class="vs-block"><div class="vs">vs</div></div>

 <div class="team-side away-side">
 ${showScore ? `<span class="team-score">${awayGoals}</span>` : ""}
 <span class="team-name">${item.away_team_name}</span>
 ${
 item.away_team_crest
 ? `<img src="${item.away_team_crest}" class="team-logo" alt="${item.away_team_name}">`
 : ""
 }
 </div>
 </div>

 ${resultLine}
 </button>

 <div class="match-body ${isOpen ? "open" : ""}">
 ${render1X2Row(item)}

 <div class="compact-grid">
 <div class="compact-box">
 <span class="label">Várható gólszám</span>
 <strong>${totalGoals}</strong>
 </div>

 <div class="compact-box">
 <span class="label">2,5 gól</span>
 <strong>${item.final_over25_tip}</strong>
 </div>

 <div class="compact-box">
 <span class="label">Mindkét csapat gól</span>
 <strong>${bttsText}</strong>
 </div>
 </div>

 ${createToggleSection("AI részletes tipp", detailHtml)}
 ${createToggleSection("Gólmátrix", goalMatrixHtml)}
 </div>
 `;

 const headerBtn = card.querySelector(".match-header");
 const body = card.querySelector(".match-body");
 const arrow = card.querySelector(".match-header .arrow");

 headerBtn.addEventListener("click", () => {
 const nowOpen = body.classList.toggle("open");
 arrow.classList.toggle("open", nowOpen);

 const current = loadOpenState(OPEN_MATCHES_KEY);
 current[matchKey] = nowOpen;
 saveOpenState(OPEN_MATCHES_KEY, current);
 });

 wireToggleButtons(card);
 return card;
}

function createLeagueBlock(league) {
 const openState = loadOpenState(OPEN_LEAGUES_KEY);
 const isOpen = !!openState[league.code];

 const liveCount = league.items.filter((x) =>
 ["LIVE", "IN_PLAY", "PAUSED"].includes((x.status || "").toUpperCase())
 ).length;

 const finishedCount = league.items.filter(
 (x) => (x.status || "").toUpperCase() === "FINISHED"
 ).length;

 const wrapper = document.createElement("section");
 wrapper.className = "league-block";

 const header = document.createElement("button");
 header.className = "league-header";

 header.innerHTML = `
 <span class="league-title-wrap">
 ${league.emblem ? `<img src="${league.emblem}" class="league-logo" alt="${league.name}">` : ""}
 <span>${league.name}</span>
 </span>

 <span class="league-meta">
 ${liveCount > 0 ? `<span class="league-live-pill">${liveCount} élő</span>` : ""}
 <span class="league-toggle-text">${league.items.length} meccs • ${finishedCount} lejátszva</span>
 <span class="arrow ${isOpen ? "open" : ""}"></span>
 </span>
 `;

 const content = document.createElement("div");
 content.className = "league-content";
 if (isOpen) content.classList.add("open");

 for (const item of league.items) {
 content.appendChild(createMatchCard(item));
 }

 header.addEventListener("click", () => {
 content.classList.toggle("open");
 const nowOpen = content.classList.contains("open");

 const arrow = header.querySelector(".arrow");
 if (arrow) arrow.classList.toggle("open", nowOpen);

 const currentState = loadOpenState(OPEN_LEAGUES_KEY);
 currentState[league.code] = nowOpen;
 saveOpenState(OPEN_LEAGUES_KEY, currentState);
 });

 wrapper.appendChild(header);
 wrapper.appendChild(content);

 return wrapper;
}

function renderOverallStats(overallStats) {
const total = overallStats?.total || 0;
const exact = overallStats?.exact || 0;
const over = overallStats?.over || 0;
const btts = overallStats?.btts || 0;
const winner = overallStats?.winner || 0;

const exactPct = total ? ((exact / total) * 100).toFixed(0) : 0;
const overPct = total ? ((over / total) * 100).toFixed(0) : 0;
const bttsPct = total ? ((btts / total) * 100).toFixed(0) : 0;
const winnerPct = total ? ((winner / total) * 100).toFixed(0) : 0;

const isOpen = "true";

aiStatsEl.innerHTML = `
<section class="card top-stat-card top-stat-collapsible">
<button class="top-stat-toggle" type="button">
<div class="top-stat-header">
<div>
<div class="top-stat-kicker">Összesített AI stat</div>
<div class="top-stat-title">AI teljesítmény</div>
</div>
<div class="top-stat-right">
<div class="top-stat-badge">${total} meccs</div>
<span class="arrow ${isOpen ? "open" : ""}"></span>
</div>
</div>
</button>

<div class="top-stat-body ${isOpen ? "open" : ""}">
<div class="top-stat-grid">
<div class="top-mini-box">
<span class="label">Pontos eredmény</span>
<strong>${exact}</strong>
<small>${exactPct}%</small>
</div>

<div class="top-mini-box highlight">
<span class="label">Helyes 1X2 tipp</span>
<strong>${winner}</strong>
<small>${winnerPct}%</small>
</div>

<div class="top-mini-box">
<span class="label">Over 2.5 találat</span>
<strong>${over}</strong>
<small>${overPct}%</small>
</div>

<div class="top-mini-box">
<span class="label">Mindkét csapat gól</span>
<strong>${btts}</strong>
<small>${bttsPct}%</small>
</div>
</div>
</div>
</section>
`;

const toggleBtn = aiStatsEl.querySelector(".top-stat-toggle");
const body = aiStatsEl.querySelector(".top-stat-body");
const arrow = aiStatsEl.querySelector(".arrow");

toggleBtn.addEventListener("click", () => {
const nowOpen = body.classList.toggle("open");
arrow.classList.toggle("open", nowOpen);
localStorage.setItem(OPEN_STATS_KEY, String(nowOpen));
});
}

function renderData(payload) {
 const items = payload.predictions || [];
 const grouped = groupByLeague(items);
 const leagues = Object.values(grouped);

 renderOverallStats(payload.overall_stats || { total: 0, exact: 0, over: 0, btts: 0 });

 const newList = document.createElement("div");

 if (!items.length) {
 statusEl.textContent = "Nincs mai predikció az adatbázisban.";
 listEl.innerHTML = "";
 return;
 }

 leagues.forEach((league) => {
 const block = createLeagueBlock(league);
 newList.appendChild(block);
 });

 listEl.replaceChildren(...newList.childNodes);
}

async function loadPredictions(forceRefresh = false, silent = false) {
 if (!silent) {
 statusEl.textContent = "Betöltés...";
 }

 try {
 if (!forceRefresh) {
 const cached = localStorage.getItem(CACHE_KEY);

 if (cached) {
 const parsed = JSON.parse(cached);

 if (Date.now() - parsed.time < CACHE_TIME) {
 renderData(parsed.data);
 if (!silent) statusEl.textContent = "Frissítve";
 return parsed.data;
 }
 }
 }

 const response = await fetch("/.netlify/functions/read-predictions");
 const data = await response.json();

 if (!response.ok) {
 throw new Error(data.error || "Szerverhiba");
 }

 localStorage.setItem(
 CACHE_KEY,
 JSON.stringify({
 time: Date.now(),
 data
 })
 );

 renderData(data);

 if (!silent) {
 statusEl.textContent = `Betöltve DB-ből: ${(data.predictions || []).length} mai predikció`;
 }

 return data;
 } catch (error) {
 if (!silent) {
 statusEl.textContent = error.message || "Hiba történt.";
 }
 return null;
 }
}


window.addEventListener("DOMContentLoaded", async () => {
 await loadPredictions(true, false);

 setInterval(() => {
 loadPredictions(true, true);
 }, 60000);
});