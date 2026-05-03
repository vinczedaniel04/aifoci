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

function renderDailyTickets(dailyTickets) {
 if (!dailyTickets.length) {
  return `<div class="ticket-empty">Ebben a hónapban még nincs AI szelvény.</div>`;
 }

 return dailyTickets
  .map((ticket, index) => {
   const dayId = `day-ticket-${String(ticket.id || index).replace(/[^a-zA-Z0-9_-]/g, "")}`;
   const isOpen = index === 0;

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

function renderRecentPredictions(recentPredictions) {
 if (!recentPredictions.length) {
  return `<div class="ticket-empty">Ebben a hónapban még nincs lezárt predikció.</div>`;
 }

 return recentPredictions
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
     <span class="mini-hit-label">1X2</span>${hitIcon(match.winner_hit)}
     <span class="mini-hit-label">O2.5</span>${hitIcon(match.over25_hit)}
     <span class="mini-hit-label">BTTS</span>${hitIcon(match.btts_hit)}
    </div>
   </div>
  `
  )
  .join("");
}

function renderMonthBlock(monthData, index) {
 const prediction = monthData.prediction_stats || {};
 const ticket = monthData.ticket_stats || {};
 const isOpen = index === 0;

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
   <section class="stats-inner-section">
    <div class="stats-section-header">
     <div>
      <div class="top-stat-kicker">Predikciók</div>
      <div class="top-stat-title">Havi AI teljesítmény</div>
     </div>
     <div class="top-stat-badge">${prediction.total || 0} lezárt meccs</div>
    </div>

    <div class="top-stat-grid">
     ${renderStatBox("Pontos eredmény", prediction.exact_hits || 0, pctText(prediction.exact_rate))}
     ${renderStatBox("Helyes 1X2", prediction.winner_hits || 0, pctText(prediction.winner_rate))}
     ${renderStatBox("Over 2.5 találat", prediction.over25_hits || 0, pctText(prediction.over25_rate))}
     ${renderStatBox("BTTS találat", prediction.btts_hits || 0, pctText(prediction.btts_rate))}
    </div>
   </section>

   <section class="stats-inner-section">
    <div class="stats-section-header">
     <div>
      <div class="top-stat-kicker">AI Tippmix</div>
      <div class="top-stat-title">Havi szelvény stat</div>
     </div>
     <div class="top-stat-badge">${ticket.ticket_days || 0} szelvény nap</div>
    </div>

    <div class="top-stat-grid">
     ${renderStatBox("Összes pick", ticket.total_picks || 0)}
     ${renderStatBox("Eltalált pick", ticket.hit_picks || 0, pctText(ticket.pick_hit_rate))}
     ${renderStatBox("Értékelt pick", ticket.settled_picks || 0)}
     ${renderStatBox("Full hit nap", ticket.full_hit_tickets || 0)}
    </div>
   </section>

   <section class="stats-inner-section">
    <div class="stats-section-header">
     <div>
      <div class="top-stat-kicker">Napi szelvények</div>
      <div class="top-stat-title">AI Tippmix bontás</div>
     </div>
    </div>

    ${renderDailyTickets(monthData.daily_tickets || [])}
   </section>

   <section class="stats-inner-section">
    <div class="stats-section-header">
     <div>
      <div class="top-stat-kicker">Legutóbbi lezárt meccsek</div>
      <div class="top-stat-title">Predikció találatok</div>
     </div>
    </div>

    ${renderRecentPredictions(monthData.recent_predictions || [])}
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