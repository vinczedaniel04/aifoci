const tokenInput = document.getElementById("adminTokenInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const reloadAdminBtn = document.getElementById("reloadAdminBtn");
const statusEl = document.getElementById("admin-status");
const panelEl = document.getElementById("admin-panel");

const TOKEN_KEY = "Bableves28.0510.";

function getToken() {
 return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(value) {
 localStorage.setItem(TOKEN_KEY, value);
}

function formatDate(value) {
 if (!value) return "-";

 try {
  return new Date(value).toLocaleString("hu-HU");
 } catch {
  return String(value);
 }
}

function safeJson(value) {
 if (!value) return {};

 if (typeof value === "object") return value;

 try {
  return JSON.parse(value);
 } catch {
  return {};
 }
}

function num(value, digits = 4) {
 const n = Number(value);
 if (!Number.isFinite(n)) return "-";
 return n.toFixed(digits);
}

function pct(value) {
 const n = Number(value);
 if (!Number.isFinite(n)) return "-";
 return `${n.toFixed(2)}%`;
}

function renderSettingRow(label, value, suffix = "") {
 return `
  <div class="admin-setting-row">
    <span>${label}</span>
    <strong>${value}${suffix}</strong>
  </div>
 `;
}

function renderModelSettings(settings) {
 if (!settings) {
  return `<div class="ticket-empty">Nincs aktív model_settings sor.</div>`;
 }

 return `
  <section class="card admin-section">
    <div class="stats-section-header">
      <div>
        <div class="top-stat-kicker">Aktív modell</div>
        <div class="top-stat-title">Model settings</div>
      </div>
      <div class="top-stat-badge">Frissítve: ${formatDate(settings.updated_at)}</div>
    </div>

    <div class="admin-settings-grid">
      ${renderSettingRow("Hazai pálya előny", num(settings.home_advantage))}
      ${renderSettingRow("Over 2.5 threshold", num(Number(settings.over25_threshold) * 100, 2), "%")}
      ${renderSettingRow("BTTS threshold", num(Number(settings.btts_threshold) * 100, 2), "%")}
      ${renderSettingRow("Minimum összgól Overhez", num(settings.min_total_goals_for_over, 3))}
      ${renderSettingRow("Minimum csapatgól BTTS-hez", num(settings.min_team_goal_for_btts, 3))}
      ${renderSettingRow("Mean regression", num(settings.mean_regression_strength))}
      ${renderSettingRow("Forma boost", num(settings.form_boost_weight))}
    </div>
  </section>
 `;
}

function renderTrainingLog(log, index) {
 const oldSettings = safeJson(log.old_settings);
 const newSettings = safeJson(log.new_settings);
 const changes = safeJson(log.changes);
 const metrics = safeJson(log.metrics);

 const isOpen = index === 0;
 const bodyId = `training-log-${log.id || index}`;

 const changeRows = Object.entries(changes)
  .map(([key, item]) => {
   const diff = Number(item.diff || 0);
   const diffClass = diff > 0 ? "positive" : diff < 0 ? "negative" : "";

   return `
    <div class="admin-change-row">
      <span>${key}</span>
      <b>${item.old} → ${item.new}</b>
      <em class="${diffClass}">${diff > 0 ? "+" : ""}${item.diff}</em>
    </div>
   `;
  })
  .join("");

 return `
  <div class="monthly-ticket day-accordion admin-log-item">
    <button class="day-accordion-header" type="button" data-admin-toggle="${bodyId}">
      <div>
        <strong>${formatDate(log.created_at)}</strong>
        <small>${log.matches_analyzed || 0} meccs alapján • ${log.error ? "Hiba" : "Sikeres tanítás"}</small>
      </div>

      <div class="day-header-right">
        <span class="top-stat-badge">${log.matches_analyzed || 0} meccs</span>
        <span class="arrow small ${isOpen ? "open" : ""}"></span>
      </div>
    </button>

    <div class="day-accordion-body ${isOpen ? "open" : ""}" id="${bodyId}">
      ${
       log.error
        ? `<div class="ticket-empty admin-error">${log.error}</div>`
        : `
          <div class="admin-metrics-grid">
            ${renderSettingRow("1X2 találati arány", pct(metrics?.overall?.winner_rate))}
            ${renderSettingRow("Over találati arány", pct(metrics?.overall?.over_rate))}
            ${renderSettingRow("BTTS találati arány", pct(metrics?.overall?.btts_rate))}
            ${renderSettingRow("Hazai favorit miss", pct(metrics?.miss_breakdown?.home_favorite_miss_rate))}
          </div>

          <div class="admin-change-list">
            ${changeRows || `<div class="ticket-empty">Nem volt változás.</div>`}
          </div>
        `
      }
    </div>
  </div>
 `;
}

function renderTrainingLogs(logs) {
 return `
  <section class="card admin-section">
    <div class="stats-section-header">
      <div>
        <div class="top-stat-kicker">Train-model</div>
        <div class="top-stat-title">Legutóbbi tanítások</div>
      </div>
      <div class="top-stat-badge">${logs.length} log</div>
    </div>

    ${
     logs.length
      ? logs.map(renderTrainingLog).join("")
      : `<div class="ticket-empty">Még nincs training log.</div>`
    }
  </section>
 `;
}

function renderTodayTicket(ticket, picks) {
 return `
  <section class="card admin-section">
    <div class="stats-section-header">
      <div>
        <div class="top-stat-kicker">Mai AI Tippmix</div>
        <div class="top-stat-title">Szelvény állapot</div>
      </div>
      <div class="top-stat-badge">${picks.length} pick</div>
    </div>

    ${
     ticket
      ? `
        <div class="admin-ticket-summary">
          ${renderSettingRow("Nap", ticket.ticket_day)}
          ${renderSettingRow("Találatok", `${ticket.hits || 0}/${ticket.total_picks || picks.length}`)}
          ${renderSettingRow("Full hit", ticket.is_full_hit ? "Igen" : "Nem")}
        </div>

        <div class="monthly-picks">
          ${
           picks.length
            ? picks
               .map(
                (pick) => `
                 <div class="monthly-pick-row">
                  <div class="monthly-pick-main">
                   <strong>${pick.home_team_name} - ${pick.away_team_name}</strong>
                   <small>${pick.pick_label} • ${Number(pick.pick_value || 0).toFixed(0)}%</small>
                  </div>
                  <span class="hit-pill ${pick.is_hit === true ? "hit" : pick.is_hit === false ? "miss" : "pending"}">
                   ${pick.is_hit === true ? "Talált" : pick.is_hit === false ? "Nem" : "Függő"}
                  </span>
                 </div>
                `
               )
               .join("")
            : `<div class="ticket-empty">Nincs pick.</div>`
          }
        </div>
      `
      : `<div class="ticket-empty">Ma még nincs AI szelvény.</div>`
    }
  </section>
 `;
}

function renderDatabaseStats(stats) {
 return `
  <section class="card admin-section">
    <div class="stats-section-header">
      <div>
        <div class="top-stat-kicker">Adatbázis</div>
        <div class="top-stat-title">Állapot</div>
      </div>
    </div>

    <div class="top-stat-grid">
      ${renderStatBox("Összes predikció", stats.predictions_total || 0)}
      ${renderStatBox("Lezárt predikció", stats.finished_predictions || 0)}
      ${renderStatBox("Mai predikció", stats.today_predictions || 0)}
      ${renderStatBox("Mai dátum", stats.today || "-")}
    </div>
  </section>
 `;
}

function renderActions() {
 const actions = [
  ["sync-matches", "Meccsek frissítése"],
  ["sync-results", "Eredmények frissítése"],
  ["sync-team-form", "Csapatforma frissítése"],
  ["sync-predictions", "Predikciók frissítése"],
  ["train-model", "Modell tanítása"]
 ];

 return `
  <section class="card admin-section">
    <div class="stats-section-header">
      <div>
        <div class="top-stat-kicker">Kézi futtatás</div>
        <div class="top-stat-title">Function műveletek</div>
      </div>
    </div>

    <div class="admin-actions-grid">
      ${actions
       .map(
        ([target, label]) => `
         <button type="button" class="admin-run-btn" data-run-target="${target}">
          ${label}
         </button>
        `
       )
       .join("")}
    </div>

    <pre id="admin-run-output" class="admin-output"></pre>
  </section>
 `;
}

function renderAdminPanel(data) {
 panelEl.innerHTML =
  renderActions() +
  renderDatabaseStats({
   ...data.database_stats,
   today: data.today
  }) +
  renderModelSettings(data.model_settings) +
  renderTodayTicket(data.today_ticket, data.today_ticket_picks || []) +
  renderTrainingLogs(data.training_logs || []);

 wireAdminToggles();
 wireRunButtons();
}

function wireAdminToggles() {
 const buttons = document.querySelectorAll("[data-admin-toggle]");

 buttons.forEach((button) => {
  button.addEventListener("click", () => {
   const id = button.getAttribute("data-admin-toggle");
   const body = document.getElementById(id);
   if (!body) return;

   const nowOpen = body.classList.toggle("open");
   const arrow = button.querySelector(".arrow");
   if (arrow) arrow.classList.toggle("open", nowOpen);
  });
 });
}

function wireRunButtons() {
 const buttons = document.querySelectorAll("[data-run-target]");
 const output = document.getElementById("admin-run-output");

 buttons.forEach((button) => {
  button.addEventListener("click", async () => {
   const target = button.getAttribute("data-run-target");

   if (!confirm(`Biztosan futtatod ezt: ${target}?`)) return;

   output.textContent = `${target} futtatása...`;

   try {
    const response = await fetch("/.netlify/functions/admin-run", {
     method: "POST",
     headers: {
      "content-type": "application/json",
      "x-admin-token": getToken()
     },
     body: JSON.stringify({ target })
    });

    const data = await response.json();

    output.textContent = JSON.stringify(data, null, 2);

    if (response.ok) {
     await loadAdminPanel();
    }
   } catch (error) {
    output.textContent = error.message || "Hiba történt.";
   }
  });
 });
}

async function loadAdminPanel() {
 const token = getToken();

 if (!token) {
  statusEl.textContent = "Add meg az admin tokent.";
  return;
 }

 statusEl.textContent = "Admin adatok betöltése...";

 try {
  const response = await fetch("/.netlify/functions/read-admin-panel", {
   headers: {
    "x-admin-token": token
   }
  });

  const data = await response.json();

  if (!response.ok) {
   throw new Error(data.error || "Nem sikerült betölteni az admin panelt.");
  }

  renderAdminPanel(data);
  statusEl.textContent = "Admin panel betöltve.";
 } catch (error) {
  console.error("Admin panel error:", error);
  statusEl.textContent = error.message || "Hiba történt.";
 }
}

window.addEventListener("DOMContentLoaded", () => {
 tokenInput.value = getToken();

 saveTokenBtn.addEventListener("click", () => {
  setToken(tokenInput.value.trim());
  loadAdminPanel();
 });

 reloadAdminBtn.addEventListener("click", () => {
  loadAdminPanel();
 });

 loadAdminPanel();
});