const statusEl = document.getElementById("stats-status");
const statsEl = document.getElementById("monthly-stats");
const reloadBtn = document.getElementById("reloadStatsBtn");

function pctText(value) {
 return `${Number(value || 0).toFixed(1)}%`;
}

function hitIcon(value) {
 if (value === true) return `<span class="hit-pill hit">Talált</span>`;
 if (value === false) return `<span class="hit-pill miss">Nem</span>`;
 return `<span class="hit-pill pending">Függő</span>`;
}

function renderStatBox(label, value, small = "") {
 return `
 <div class="top-mini-box">
  <span class="label">${label}</span>
  <strong>${value}</strong>
  ${small ? `<small>${small}</small>` : ""}
 </div>
 `;
}

function safeDomId(prefix, value) {
 return `${prefix}-${String(value || "")
  .replace(/[^a-zA-Z0-9_-]/g, "")
  .slice(0, 80)}`;
}

function renderDailyTickets(dailyTickets) {
 if (!dailyTickets.length) {
  return `<div class="ticket-empty">Ebben a hónapban még nincs AI szelvény.</div>`;
 }

 return dailyTickets
  .map((ticket, index) => {
   const dayId = safeDomId("day-ticket", ticket.id || index);
   const isOpen = index === false;

   const picksHtml = (ticket.picks || [])
    .map(
     (pick) => `
     <div class="monthly-pick-row">
      <div class="monthly-pick-main">
       <strong>${pick.home_team_name} - ${pick.away_team_name}</strong>
       <small>${pick.pick_label} • ${Number(pick.pick_value || 0).toFixed(0)}%</small>
      </div>
      ${hitIcon(pick.is_hit)}
     </div>
    `
    )
    .join("");

   return `
   <div class="monthly-ticket day-accordion">
    <button class="day-accordion-header" type="button" data-day-target="${dayId}">
     <div>
      <strong>${ticket.ticket_day}</strong>
      <small>${ticket.hits}/${ticket.total_picks} találat • ${pctText(ticket.hit_rate)}</small>
     </div>

     <div class="day-header-right">
      ${
       ticket.is_full_hit
        ? `<span class="ticket-pick-strength">FULL HIT</span>`
        : `<span class="ticket-pick-strength">${ticket.hits}/${ticket.total_picks}</span>`
      }
      <span class="arrow small ${isOpen ? "open" : ""}"></span>
     </div>
    </button>

    <div class="day-accordion-body ${isOpen ? "open" : ""}" id="${dayId}">
     <div class="monthly-picks">
      ${picksHtml || `<div class="ticket-empty">Ehhez a naphoz nincs pick.</div>`}
     </div>
    </div>
   </div>
  `;
  })
  .join("");
}

function renderDailyPredictions(dailyPredictions) {
 if (!dailyPredictions.length) {
  return `<div class="ticket-empty">Ebben a hónapban még nincs lezárt predikció.</div>`;
 }

 return dailyPredictions
  .map((day, index) => {
   const dayId = safeDomId("day-prediction", day.day || index);
   const isOpen = index === false;

   const matchesHtml = (day.matches || [])
    .map(
     (match) => `
     <div class="monthly-match-row">
      <div class="monthly-match-main">
       <strong>${match.home_team_name} - ${match.away_team_name}</strong>
       <small>
        Tipp: ${match.predicted_score || "-"} • Eredmény: ${match.actual_score || "-"}
       </small>
      </div>
      <div class="monthly-hit-group">
       <span class="mini-hit-label">Pontos</span>${hitIcon(match.exact_hit)}
       <span class="mini-hit-label">1X2</span>${hitIcon(match.winner_hit)}
       <span class="mini-hit-label">O2.5</span>${hitIcon(match.over25_hit)}
       <span class="mini-hit-label">BTTS</span>${hitIcon(match.btts_hit)}
      </div>
     </div>
    `
    )
    .join("");

   return `
   <div class="monthly-ticket day-accordion">
    <button class="day-accordion-header" type="button" data-day-target="${dayId}">
     <div>
      <strong>${day.day}</strong>
      <small>
       ${day.total || 0} meccs •
       Pontos ${day.exact_hits || 0}/${day.total || 0} •
       1X2 ${day.winner_hits || 0}/${day.total || 0} •
       O2.5 ${day.over25_hits || 0}/${day.total || 0} •
       BTTS ${day.btts_hits || 0}/${day.total || 0}
      </small>
     </div>

     <div class="day-header-right">
      <span class="top-stat-badge">${pctText(day.winner_rate)} 1X2</span>
      <span class="arrow small ${isOpen ? "open" : ""}"></span>
     </div>
    </button>

    <div class="day-accordion-body ${isOpen ? "open" : ""}" id="${dayId}">
     <div class="monthly-picks">
      ${matchesHtml || `<div class="ticket-empty">Ehhez a naphoz nincs lezárt meccs.</div>`}
     </div>
    </div>
   </div>
  `;
  })
  .join("");
}

function renderMonthBlock(monthData, index) {
 const prediction = monthData.prediction_stats || {};
 const ticket = monthData.ticket_stats || {};
 const isOpen = false;

 const ticketSectionId = safeDomId("month-tickets", monthData.month);
 const predictionSectionId = safeDomId("month-predictions", monthData.month);

 return `
 <section class="card month-accordion">
  <button class="month-accordion-header" type="button">
   <div>
    <div class="top-stat-kicker">${monthData.month}</div>
    <div class="month-title">${monthData.label}</div>
   </div>

   <div class="month-header-right">
    <span class="top-stat-badge">${prediction.total || 0} meccs</span>
    <span class="top-stat-badge">${ticket.total_picks || 0} pick</span>
    <span class="arrow ${isOpen ? "open" : ""}"></span>
   </div>
  </button>

  <div class="month-accordion-body ${isOpen ? "open" : ""}">
   <section class="stats-inner-section monthly-overview-section">
    <div class="stats-section-header compact">
     <div>
      <div class="top-stat-kicker">Összegzés</div>
      <div class="top-stat-title">Havi teljesítmény</div>
     </div>
    </div>

    <div class="monthly-overview-grid">
     <div class="monthly-summary-card">
      <div class="monthly-summary-head">
       <span>AI predikciók</span>
       <strong>${prediction.total || 0}</strong>
      </div>

      <div class="monthly-summary-list">
       <div><span>Pontos eredmény</span><b>${prediction.exact_hits || 0} / ${prediction.total || 0}</b><em>${pctText(prediction.exact_rate)}</em></div>
       <div><span>Helyes 1X2</span><b>${prediction.winner_hits || 0} / ${prediction.total || 0}</b><em>${pctText(prediction.winner_rate)}</em></div>
       <div><span>Over 2.5</span><b>${prediction.over25_hits || 0} / ${prediction.total || 0}</b><em>${pctText(prediction.over25_rate)}</em></div>
       <div><span>BTTS</span><b>${prediction.btts_hits || 0} / ${prediction.total || 0}</b><em>${pctText(prediction.btts_rate)}</em></div>
      </div>
     </div>

     <div class="monthly-summary-card highlight">
      <div class="monthly-summary-head">
       <span>AI Tippmix szelvény</span>
       <strong>${ticket.total_picks || 0}</strong>
      </div>

      <div class="monthly-summary-list">
       <div><span>Szelvény nap</span><b>${ticket.ticket_days || 0}</b><em>nap</em></div>
       <div><span>Eltalált pick</span><b>${ticket.hit_picks || 0} / ${ticket.settled_picks || 0}</b><em>${pctText(ticket.pick_hit_rate)}</em></div>
       <div><span>Összes pick</span><b>${ticket.total_picks || 0}</b><em>db</em></div>
       <div><span>Full hit nap</span><b>${ticket.full_hit_tickets || 0}</b><em>db</em></div>
      </div>
     </div>
    </div>
   </section>

   <section class="stats-inner-section stats-collapsible-section">
    <button class="stats-sub-toggle" type="button" data-day-target="${ticketSectionId}">
     <span>
      <b>Napi szelvények</b>
      <small>AI Tippmix szelvény bontás napokra</small>
     </span>
     <span class="arrow small"></span>
    </button>

    <div class="stats-sub-body" id="${ticketSectionId}">
     ${renderDailyTickets(monthData.daily_tickets || [])}
    </div>
   </section>

   <section class="stats-inner-section stats-collapsible-section">
    <button class="stats-sub-toggle" type="button" data-day-target="${predictionSectionId}">
     <span>
      <b>Napi predikciók</b>
      <small>Találatok napi bontásban</small>
     </span>
     <span class="arrow small"></span>
    </button>

    <div class="stats-sub-body" id="${predictionSectionId}">
     ${renderDailyPredictions(monthData.daily_predictions || [])}
    </div>
   </section>
  </div>
 </section>
 `;
}

function wireMonthAccordions() {
 const blocks = document.querySelectorAll(".month-accordion");

 blocks.forEach((block) => {
  const header = block.querySelector(".month-accordion-header");
  const body = block.querySelector(".month-accordion-body");
  const arrow = block.querySelector(".month-accordion-header .arrow");

  header.addEventListener("click", () => {
   const nowOpen = body.classList.toggle("open");
   if (arrow) arrow.classList.toggle("open", nowOpen);
  });
 });
}

function wireDayAccordions() {
 const buttons = document.querySelectorAll("[data-day-target]");

 buttons.forEach((button) => {
  button.addEventListener("click", (event) => {
   event.stopPropagation();

   const targetId = button.getAttribute("data-day-target");
   const target = document.getElementById(targetId);
   if (!target) return;

   const nowOpen = target.classList.toggle("open");

   const arrow = button.querySelector(".arrow");
   if (arrow) {
    arrow.classList.toggle("open", nowOpen);
   }
  });
 });
}

function renderStats(data) {
 const months = data.months || [];

 if (!months.length) {
  statsEl.innerHTML = `<div class="ticket-empty">Még nincs havi statisztikai adat.</div>`;
  return;
 }

 statsEl.innerHTML = months.map(renderMonthBlock).join("");
 wireMonthAccordions();
 wireDayAccordions();
}

async function loadMonthlyStats() {
 statusEl.textContent = "Betöltés...";

 try {
  const response = await fetch("/.netlify/functions/read-monthly-stats");
  const data = await response.json();

  if (!response.ok) {
   throw new Error(data.error || "Nem sikerült betölteni a havi statisztikát");
  }

  renderStats(data);
  statusEl.textContent = `Betöltve: ${data.months?.length || 0} hónap`;
 } catch (error) {
  console.error("Monthly stats error:", error);
  statusEl.textContent = error.message || "Hiba történt.";
 }
}

window.addEventListener("DOMContentLoaded", () => {
 reloadBtn.addEventListener("click", () => {
  loadMonthlyStats();
 });

 loadMonthlyStats();
});