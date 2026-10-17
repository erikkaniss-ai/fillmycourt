(() => {
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const state = { token: null, org: null, orgs: [], view: "today", today: null, calendar: null, demo: false };
  // Synthetic demo is opt-in and restricted to the separate private-preview host
  // and loopback dev. This NEVER activates on public fillmycourt.com.
  const previewHost = /^(?:fillmycourt-preview|deploy-preview-[1-9][0-9]*--fillmycourt-preview)\.netlify\.app$/.test(location.hostname || "");
  const loopbackHost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const canExploreDemo = previewHost || loopbackHost;
  state.demo = canExploreDemo && new URLSearchParams(location.search).get("demo") === "1";
  const el = {
    auth: q("#authGate"), workspace: q("#workspace"), org: q("#orgSelect"),
    identity: q("#identity"), signOut: q("#signOut"), date: q("#dateInput"),
    refresh: q("#refreshButton"), error: q("#error"), pageTitle: q("#pageTitle"),
    today: q("#todayView"), calendar: q("#calendarView"), revenue: q("#revenueView"),
    kpis: q("#kpis"), util: q("#courtUtilisation"), utilBadge: q("#utilisationBadge"),
    empty: q("#emptyCapacity"), timeline: q("#calendarTimeline"), revenueKpis: q("#revenueKpis"),
    opportunityQueue: q("#opportunityQueue"), courtComparison: q("#courtComparison"),
    demoNotice: q("#demoNotice"), demoLink: q("#demoPreviewLink"),
  };

  el.date.value = new Date().toISOString().slice(0, 10);
  if (el.demoLink) el.demoLink.hidden = !canExploreDemo;
  if (el.demoNotice) el.demoNotice.hidden = !state.demo;

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[char]));
  }

  function mon(amount, currency) {
    return new Intl.NumberFormat("en-IE", {
      style: "currency", currency: currency || "EUR", maximumFractionDigits: 0,
    }).format(Number(amount || 0) / 100);
  }

  function hours(minutes) {
    const total = Number(minutes || 0);
    return `${(total / 60).toFixed(total % 60 ? 1 : 0)}h`;
  }

  function hasRateCoverage(court) {
    return court?.has_rate_coverage === true;
  }

  function formatTime(iso, timezone = state.today?.timezone || "Europe/Lisbon") {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  }

  function hhmm(minutes) {
    const hour = Math.floor(Number(minutes || 0) / 60) % 24;
    const minute = Number(minutes || 0) % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function session() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const token = hash.get("access_token");
    if (token) {
      localStorage.setItem("fill.access", token);
      history.replaceState(null, "", location.pathname + location.search);
      return token;
    }
    return localStorage.getItem("fill.access");
  }

  async function api(path) {
    // Demo calls never touch a backend or persist/forward any token.
    if (state.demo) {
      if (!window.FillDemo?.get) throw Error("Synthetic demo dataset unavailable.");
      return window.FillDemo.get(path);
    }
    if (!state.token) throw Error("AUTH_REQUIRED");
    const response = await fetch(path, { headers: { Authorization: `Bearer ${state.token}` } });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem("fill.access");
        state.token = null;
        showAuth();
      }
      throw Error(body.message || body.error || `Request failed ${response.status}`);
    }
    return body;
  }

  function showAuth() {
    el.auth.hidden = false;
    el.workspace.hidden = true;
    el.signOut.hidden = true;
    el.identity.textContent = "Not signed in";
  }

  function showWorkspace() {
    el.auth.hidden = true;
    el.workspace.hidden = false;
    el.signOut.hidden = false;
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = "";
  }

  function fail(error) {
    el.error.hidden = false;
    el.error.textContent = error.message || String(error);
  }

  function renderKpis(target, values) {
    target.innerHTML = values.map(([label, value, hint]) => (
      `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`
    )).join("");
  }

  function rateCoverageSummary(summary) {
    return `${Number(summary.courts_with_rate_coverage || 0)} / ${Number(summary.active_courts || 0)} courts`;
  }

  function windowStarts(window, duration) {
    return Number(window[`bookable_${duration}_count`] || 0);
  }

  function bestQuote(window, currency) {
    if (window.best_amount_minor == null) return "No configured quote";
    const duration = window.best_duration_minutes ? ` · ${window.best_duration_minutes} min` : "";
    return `${mon(window.best_amount_minor, window.currency || currency)}${duration}`;
  }

  function renderToday() {
    const summary = state.today.summary || {};
    const currency = state.today.currency || "EUR";
    renderKpis(el.kpis, [
      ["Utilisation", `${summary.utilization_pct || 0}%`, "Booked / sellable capacity"],
      ["Revenue", mon(summary.revenue_minor, currency), "Confirmed + pending payment only"],
      ["Bookings", summary.bookings || 0, "Core booking count for this day"],
      ["Empty capacity", hours(summary.empty_minutes), "Available after holds and blocks"],
    ]);

    el.utilBadge.textContent = `${summary.utilization_pct || 0}% overall`;
    el.util.innerHTML = (state.today.courts || []).map((court) => {
      if (!hasRateCoverage(court)) {
        return `<div class="court-row"><strong>${esc(court.court_name)}</strong><span class="coverage-gap">Needs rate coverage</span><em>—</em></div>`;
      }
      const utilisation = Number(court.utilization_pct || 0);
      return `<div class="court-row"><strong>${esc(court.court_name)}</strong><div class="meter" title="${esc(utilisation)}%"><span style="width:${Math.max(0, Math.min(100, utilisation))}%"></span></div><em>${esc(utilisation)}%</em></div>`;
    }).join("") || '<p class="muted">No active courts.</p>';

    const windows = (state.today.empty_windows || []).slice(0, 8);
    el.empty.innerHTML = windows.map((window) => (
      `<div class="empty-item"><div><strong>${esc(window.court_name)}</strong><small>${esc(formatTime(window.starts_at))}–${esc(formatTime(window.ends_at))}</small></div><span>${esc(hours(window.duration_minutes))} open</span></div>`
    )).join("") || '<p class="muted">No unsold windows of 60+ minutes.</p>';

    renderRecovery();
  }

  function renderRecovery() {
    if (!state.today) return;
    const summary = state.today.summary || {};
    const currency = state.today.currency || "EUR";
    const windows = [...(state.today.empty_windows || [])].sort((left, right) => (
      Number(right.duration_minutes || 0) - Number(left.duration_minutes || 0)
      || new Date(left.starts_at) - new Date(right.starts_at)
    ));
    const highestQuote = summary.highest_single_quote_minor
      ? mon(summary.highest_single_quote_minor, currency)
      : "—";

    renderKpis(el.revenueKpis, [
      ["Empty capacity", hours(summary.empty_minutes), "Current sellable time only"],
      ["60-min starts", summary.bookable_60_starts || 0, "Configured options in empty windows"],
      ["90-min starts", summary.bookable_90_starts || 0, "Configured options in empty windows"],
      ["Top slot quote", highestQuote, "Configured rate; not a forecast"],
      ["Rate coverage", rateCoverageSummary(summary), "Uncovered courts are excluded from capacity"],
    ]);

    el.opportunityQueue.innerHTML = windows.map((window, index) => (
      `<article class="opportunity-card">
        <div class="opportunity-card-head">
          <div class="opportunity-main"><span class="opportunity-rank">#${index + 1}</span><div><div class="opportunity-title-line"><strong>${esc(window.court_name || "Court")}</strong><span class="opportunity-status">READ-ONLY</span></div><small>${esc(formatTime(window.starts_at))}–${esc(formatTime(window.ends_at))} · current Core snapshot</small></div></div>
          <div class="opportunity-value"><strong>${esc(hours(window.duration_minutes))}</strong><span>UNSOLD WINDOW</span></div>
        </div>
        <div class="opportunity-metrics"><span><b>${esc(windowStarts(window, 60))}</b> 60-min starts</span><span><b>${esc(windowStarts(window, 90))}</b> 90-min starts</span><span><b>${esc(bestQuote(window, currency))}</b> configured best quote</span><span><b>${esc(window.currency || currency)}</b> rate currency</span><span><b>No action</b> demand and CRM unavailable</span></div>
        <div class="opportunity-action"><span>BOUNDARY</span><strong>Capacity candidate only</strong><small>No recommendation, audience, price change, message, provider call, hold, or booking is created.</small></div>
      </article>`
    )).join("") || '<p class="muted">No sellable empty window of 60+ minutes was returned by Core.</p>';

    renderCourtComparison(windows, currency);
  }

  function renderCourtComparison(windows, currency) {
    const byCourt = new Map();
    windows.forEach((window) => {
      const current = byCourt.get(window.court_id) || { best: null, starts60: 0, starts90: 0 };
      current.starts60 += windowStarts(window, 60);
      current.starts90 += windowStarts(window, 90);
      if (window.best_amount_minor != null && (current.best == null || Number(window.best_amount_minor) > Number(current.best))) {
        current.best = window.best_amount_minor;
      }
      byCourt.set(window.court_id, current);
    });
    const rows = [...(state.today.courts || [])].sort((left, right) => String(left.court_name).localeCompare(String(right.court_name)));
    const body = rows.map((court) => {
      const recovery = byCourt.get(court.court_id) || { best: null, starts60: 0, starts90: 0 };
      const coverage = hasRateCoverage(court)
        ? (court.sellable_windows || []).map((window) => `${hhmm(window.start_minute)}–${hhmm(window.end_minute)}`).join(" · ")
        : "No rate coverage";
      const quote = recovery.best == null ? "—" : mon(recovery.best, currency);
      return `<div class="comparison-row"><strong>${esc(court.court_name)}</strong><span>${hasRateCoverage(court) ? `${esc(court.utilization_pct || 0)}%` : "—"}</span><span>${esc(mon(court.revenue_minor || 0, currency))}</span><span>${esc(court.bookings || 0)}</span><span>${esc(hours(court.empty_minutes || 0))}</span><span class="coverage-cell">${esc(coverage)}</span><span>${esc(quote)}<small>${esc(`${recovery.starts60}×60 · ${recovery.starts90}×90`)}</small></span></div>`;
    }).join("");
    el.courtComparison.innerHTML = body
      ? `<div class="comparison-table"><div class="comparison-row comparison-head"><span>Court</span><span>Util.</span><span>Revenue</span><span>Bookings</span><span>Empty</span><span>Rate coverage</span><span>Top configured quote</span></div>${body}</div>`
      : '<p class="muted">No active courts.</p>';
  }

  function minuteInZone(iso, timezone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0) % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
  }

  async function loadCalendar() {
    const start = state.today?.day_start;
    const end = state.today?.day_end;
    if (!start || !end) throw Error("Authoritative day bounds are unavailable.");
    state.calendar = await api(`/api/fmc/${encodeURIComponent(state.org)}/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    renderCalendar();
  }

  function renderCalendar() {
    // Core Today.sellable_windows describe tariff-covered hours, not the
    // complete timeline. Bookings, holds and blocks can also exist on courts
    // with missing rates or outside the configured selling window.
    const today = state.today || {};
    const dayStart = Date.parse(today.day_start);
    const dayEnd = Date.parse(today.day_end);
    const timezone = today.timezone || "Europe/Lisbon";
    if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) {
      el.timeline.innerHTML = '<p class="muted">Authoritative day bounds are unavailable.</p>';
      return;
    }
    const events = [
      ...(state.calendar?.blocks || []).map((row) => ({ ...row, kind: "block", status: "blocked" })),
      ...(state.calendar?.bookings || [])
        // Cancelled/failed records are history, never active occupancy.
        .filter((row) => ["confirmed", "pending_payment"].includes(row.status))
        .map((row) => ({ ...row, kind: "booking" })),
      ...(state.calendar?.holds || []).map((row) => ({ ...row, kind: "hold", status: "held" })),
    ].map((row) => {
      const rawStart = Date.parse(row.starts_at);
      const rawEnd = Date.parse(row.ends_at);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
      const clippedStart = Math.max(rawStart, dayStart);
      const clippedEnd = Math.min(rawEnd, dayEnd);
      if (clippedEnd <= clippedStart) return null;
      const startMin = clippedStart === dayStart ? 0
        : minuteInZone(new Date(clippedStart).toISOString(), timezone);
      const endMin = clippedEnd === dayEnd ? 1440
        : minuteInZone(new Date(clippedEnd).toISOString(), timezone);
      return { ...row, startMin, endMin };
    }).filter((row) => row && row.endMin > row.startMin);

    // Include every active court, even when rate coverage is absent. Otherwise
    // existing off-rate or manual bookings silently disappear from Calendar.
    const courts = today.courts || [];
    if (!courts.length) {
      el.timeline.innerHTML = '<p class="muted">No active courts returned for this day.</p>';
      return;
    }
    const windows = courts.flatMap((court) => (court.sellable_windows || [])
      .flatMap((window) => [Number(window.start_minute), Number(window.end_minute)]));
    const bounds = [...windows, ...events.flatMap((row) => [row.startMin, row.endMin])]
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1440);
    if (!bounds.length) {
      el.timeline.innerHTML = '<p class="muted">No rate-covered hours or booking events for this day.</p>';
      return;
    }
    const start = Math.max(0, Math.floor(Math.min(...bounds) / 30) * 30);
    const end = Math.min(1440, Math.ceil(Math.max(...bounds) / 30) * 30);
    if (end <= start) {
      el.timeline.innerHTML = '<p class="muted">No calendar intervals for this day.</p>';
      return;
    }
    const steps = [];
    for (let minute = start; minute < end; minute += 30) steps.push(minute);
    const labels = steps.map((minute, index) => index % 2 === 0
      ? `<span>${hhmm(minute)}</span>` : "<span></span>").join("");
    const lanes = courts.map((court) => {
      const courtEvents = events.filter((row) => row.court_id === court.court_id);
      const cells = steps.map((minute) => {
        // Event precedence MUST come before rate-window state. A confirmed
        // booking stays visible even if the court has no configured tariff.
        const event = courtEvents.find((row) => row.startMin < minute + 30 && row.endMin > minute);
        if (event) {
          const kind = event.kind === "block" ? "blocked" : event.kind === "hold" ? "held" : "booked";
          const label = event.startMin >= minute && event.startMin < minute + 30
            ? (event.kind === "block" ? "Block" : event.kind === "hold" ? "Hold" : event.status)
            : "";
          const source = event.kind === "block" ? (event.reason || "Blocked")
            : event.kind === "hold" ? "Active booking hold" : event.source || event.status;
          return `<div class="lane-cell ${kind}" title="${esc(`${hhmm(event.startMin)}–${hhmm(event.endMin)} · ${source}`)}"><span>${esc(label)}</span></div>`;
        }
        const priced = (court.sellable_windows || []).some((window) =>
          Number(window.start_minute) <= minute && Number(window.end_minute) >= minute + 30);
        if (!priced) return `<div class="lane-cell closed" title="${hhmm(minute)} — no configured rate coverage"></div>`;
        return `<div class="lane-cell open" title="${hhmm(minute)} — rate-covered, no active Core occupancy recorded"></div>`;
      }).join("");
      return `<div class="court-lane"><strong>${esc(court.court_name)}</strong><div class="lane-track" style="grid-template-columns:repeat(${steps.length},minmax(22px,1fr))">${cells}</div><em>${hasRateCoverage(court) ? `${esc(court.utilization_pct)}%` : "No rate"}</em></div>`;
    }).join("");
    el.timeline.innerHTML = `<div class="court-grid"><div class="court-axis"><span>COURT</span><div class="time-axis" style="grid-template-columns:repeat(${steps.length},minmax(22px,1fr))">${labels}</div><span>UTIL.</span></div>${lanes}</div><div class="timeline-legend"><span><i class="legend-open"></i>Rate-covered / unoccupied</span><span><i class="legend-booked"></i>Booked</span><span><i class="legend-held"></i>Held</span><span><i class="legend-blocked"></i>Blocked</span><span><i class="legend-closed"></i>No rate coverage</span></div><p class="muted calendar-footnote">Cancelled or failed bookings do not occupy capacity. Rate coverage does not itself confirm a new booking can be completed.</p>`;
  }

  async function load() {
    if (!state.org) return;
    clearError();
    try {
      state.today = await api(`/api/fmc/${encodeURIComponent(state.org)}/today?date=${encodeURIComponent(el.date.value)}`);
      state.calendar = null;
      renderToday();
      if (state.view === "calendar") await loadCalendar();
    } catch (error) {
      fail(error);
    }
  }

  async function init() {
    state.token = state.demo ? null : session();
    if (!state.demo && !state.token) return showAuth();
    try {
      const me = await api("/api/me");
      el.identity.textContent = state.demo ? "SYNTHETIC DEMO — no account" : (me.user?.email || "Signed in");
      if (state.demo) el.signOut.textContent = "Exit demo";
      const organizations = await api("/api/fmc/organizations");
      state.orgs = organizations.items || [];
      el.org.innerHTML = state.orgs.map((org) => (
        `<option value="${esc(org.id)}">${esc(org.name)} · ${esc(org.role)}</option>`
      )).join("") || '<option value="">No organisation access</option>';
      state.org = state.orgs[0]?.id || null;
      showWorkspace();
      if (state.org) await load();
    } catch (error) {
      fail(error);
    }
  }

  qa(".nav-item").forEach((button) => button.addEventListener("click", async () => {
    state.view = button.dataset.view;
    qa(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
    el.pageTitle.textContent = state.view === "today" ? "Today" : state.view === "calendar" ? "Calendar" : "Revenue & Capacity";
    el.today.hidden = state.view !== "today";
    el.calendar.hidden = state.view !== "calendar";
    el.revenue.hidden = state.view !== "revenue";
    if (state.view === "calendar") {
      try { await loadCalendar(); } catch (error) { fail(error); }
    }
  }));

  el.org.addEventListener("change", () => {
    state.org = el.org.value;
    load();
  });
  el.date.addEventListener("change", load);
  el.refresh.addEventListener("click", load);
  el.signOut.addEventListener("click", () => {
    if (state.demo) {
      location.assign("/fill/");
      return;
    }
    localStorage.removeItem("fill.access");
    state.token = null;
    showAuth();
  });

  init();
})();
