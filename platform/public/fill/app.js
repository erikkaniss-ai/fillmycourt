(() => {
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const state = { token: null, org: null, orgs: [], view: "today", today: null, calendar: null, courts: [] };
  const el = {
    auth: q("#authGate"), workspace: q("#workspace"), org: q("#orgSelect"),
    identity: q("#identity"), signOut: q("#signOut"), date: q("#dateInput"),
    refresh: q("#refreshButton"), error: q("#error"), pageTitle: q("#pageTitle"),
    today: q("#todayView"), calendar: q("#calendarView"), revenue: q("#revenueView"),
    kpis: q("#kpis"), util: q("#courtUtilisation"), utilBadge: q("#utilisationBadge"),
    empty: q("#emptyCapacity"), timeline: q("#calendarTimeline"), revenueKpis: q("#revenueKpis"),
    opportunityQueue: q("#opportunityQueue"), courtComparison: q("#courtComparison"),
  };

  el.date.value = new Date().toISOString().slice(0, 10);

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[char]));
  }

  function mon(amount, currency) {
    return new Intl.NumberFormat("en-IE", {
      style: "currency", currency: currency || "EUR", maximumFractionDigits: 0,
    }).format((amount || 0) / 100);
  }

  function hours(minutes) {
    const total = Number(minutes || 0);
    return `${(total / 60).toFixed(total % 60 ? 1 : 0)}h`;
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

  function fail(error) {
    el.error.hidden = false;
    el.error.textContent = error.message || String(error);
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = "";
  }

  function hasRateCoverage(court) {
    return court?.has_rate_coverage === true;
  }

  async function init() {
    state.token = session();
    if (!state.token) return showAuth();
    try {
      const me = await api("/api/me");
      el.identity.textContent = me.user?.email || "Signed in";
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

  async function load() {
    if (!state.org) return;
    clearError();
    const date = el.date.value;
    try {
      const [today, courts] = await Promise.all([
        api(`/api/fmc/${encodeURIComponent(state.org)}/today?date=${encodeURIComponent(date)}`),
        api(`/api/fmc/${encodeURIComponent(state.org)}/courts`),
      ]);
      state.today = today;
      state.courts = courts.items || [];
      renderToday();
      if (state.view === "calendar") await loadCalendar();
    } catch (error) {
      fail(error);
    }
  }

  function renderKpis(target, values) {
    target.innerHTML = values.map(([label, value, hint]) => (
      `<article class="kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`
    )).join("");
  }

  function rateCoverageSummary(summary) {
    const active = Number(summary.active_courts || 0);
    const covered = Number(summary.courts_with_rate_coverage || 0);
    return `${covered} / ${active} courts`;
  }

  function renderToday() {
    const summary = state.today.summary || {};
    const currency = state.today.currency || "EUR";
    renderKpis(el.kpis, [
      ["Utilisation", `${summary.utilization_pct || 0}%`, "Booked / sellable capacity"],
      ["Revenue", mon(summary.revenue_minor, currency), "Confirmed + pending payment"],
      ["Bookings", summary.bookings || 0, "Active bookings today"],
      ["Empty capacity", hours(summary.empty_minutes), "Still sellable today"],
    ]);

    el.utilBadge.textContent = `${summary.utilization_pct || 0}% overall`;
    el.util.innerHTML = (state.today.courts || []).map((court) => {
      if (!hasRateCoverage(court)) {
        return `<div class="court-row"><strong>${esc(court.court_name)}</strong><span class="coverage-gap">Needs rate coverage</span><em>—</em></div>`;
      }
      const utilization = Number(court.utilization_pct || 0);
      return `<div class="court-row"><strong>${esc(court.court_name)}</strong><div class="meter" title="${esc(utilization)}%"><span style="width:${Math.max(0, Math.min(100, utilization))}%"></span></div><em>${esc(utilization)}%</em></div>`;
    }).join("") || '<p class="muted">No active courts.</p>';

    const timezone = state.today.timezone || "Europe/Lisbon";
    const formatTime = (iso) => new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
    const windows = (state.today.empty_windows || []).slice(0, 8);
    el.empty.innerHTML = windows.map((window) => (
      `<div class="empty-item"><div><strong>${esc(window.court_name)}</strong><small>${esc(formatTime(window.starts_at))}–${esc(formatTime(window.ends_at))}</small></div><span>${hours(window.duration_minutes)} open</span></div>`
    )).join("") || '<p class="muted">No unsold windows of 60+ minutes.</p>';

    renderRevenue();
  }

  function renderRevenue() {
    if (!state.today || !el.revenueKpis || !el.opportunityQueue) return;
    const summary = state.today.summary || {};
    const currency = state.today.currency || "EUR";
    const windows = [...(state.today.empty_windows || [])].sort((left, right) => (
      Number(right.best_amount_minor || 0) - Number(left.best_amount_minor || 0)
      || Number(right.duration_minutes || 0) - Number(left.duration_minutes || 0)
      || new Date(left.starts_at) - new Date(right.starts_at)
    ));
    const pricedStarts = Number(summary.bookable_60_starts || 0) + Number(summary.bookable_90_starts || 0);
    const uncovered = Number(summary.courts_without_rate_coverage || 0);
    renderKpis(el.revenueKpis, [
      ["Revenue today", mon(summary.revenue_minor, currency), "Confirmed + pending payment"],
      ["Utilisation", `${summary.utilization_pct || 0}%`, "Booked / sellable capacity"],
      ["Rate coverage", rateCoverageSummary(summary), uncovered ? `${uncovered} court needs attention` : "All active courts covered"],
      ["Priced starts", pricedStarts, "60 + 90 minute bookable starts"],
      ["Highest quote", mon(summary.highest_single_quote_minor, currency), summary.highest_single_quote_duration_minutes ? `Authoritative ${summary.highest_single_quote_duration_minutes} min quote` : "No priced opportunity"],
    ]);

    const timezone = state.today.timezone || "Europe/Lisbon";
    const formatTime = (iso) => new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
    el.opportunityQueue.innerHTML = windows.slice(0, 16).map((window, index) => {
      const topQuote = window.best_amount_minor == null ? "—" : mon(window.best_amount_minor, window.currency || currency);
      const detail = `${window.bookable_60_count || 0} × 60m · ${window.bookable_90_count || 0} × 90m`;
      const quoteCaption = window.best_duration_minutes ? `${window.best_duration_minutes} MIN TOP QUOTE` : "NO PRICED START";
      return `<div class="opportunity-item"><div class="opportunity-main"><span class="opportunity-rank">#${index + 1}</span><div><strong>${esc(window.court_name)}</strong><small>${esc(formatTime(window.starts_at))}–${esc(formatTime(window.ends_at))} · ${hours(window.duration_minutes)} unsold</small><small class="opportunity-quotes">${esc(detail)}</small></div></div><div class="opportunity-value"><strong>${esc(topQuote)}</strong><span>${esc(quoteCaption)}</span></div></div>`;
    }).join("") || '<p class="muted">No unsold sellable windows of 60+ minutes.</p>';

    if (el.courtComparison) renderCourtComparison(windows, currency);
  }

  function renderCourtComparison(windows, currency) {
    const opportunitiesByCourt = new Map();
    windows.forEach((window) => {
      const current = opportunitiesByCourt.get(window.court_id) || { best: 0, starts60: 0, starts90: 0 };
      current.best = Math.max(current.best, Number(window.best_amount_minor || 0));
      current.starts60 += Number(window.bookable_60_count || 0);
      current.starts90 += Number(window.bookable_90_count || 0);
      opportunitiesByCourt.set(window.court_id, current);
    });
    const courts = [...(state.today.courts || [])].sort((left, right) => (
      Number(right.revenue_minor || 0) - Number(left.revenue_minor || 0)
      || Number(right.utilization_pct || 0) - Number(left.utilization_pct || 0)
    ));
    const body = courts.map((court) => {
      const opportunity = opportunitiesByCourt.get(court.court_id) || { best: 0, starts60: 0, starts90: 0 };
      const sellable = court.sellable_windows || [];
      const coverage = sellable.length
        ? sellable.map((window) => `${hhmm(Number(window.start_minute))}–${hhmm(Number(window.end_minute))}`).join(" · ")
        : "No rate coverage";
      const topQuote = opportunity.best > 0 ? mon(opportunity.best, currency) : "—";
      return `<div class="comparison-row"><strong>${esc(court.court_name)}</strong><span>${hasRateCoverage(court) ? `${esc(court.utilization_pct || 0)}%` : "—"}</span><span>${mon(court.revenue_minor || 0, currency)}</span><span>${esc(court.bookings || 0)}</span><span>${hours(court.empty_minutes || 0)}</span><span class="coverage-cell">${esc(coverage)}</span><span>${topQuote}<small>${esc(`${opportunity.starts60}×60 · ${opportunity.starts90}×90`)}</small></span></div>`;
    }).join("");
    el.courtComparison.innerHTML = `<div class="comparison-table"><div class="comparison-row comparison-head"><span>Court</span><span>Util.</span><span>Revenue</span><span>Bookings</span><span>Empty</span><span>Rate coverage</span><span>Top quote</span></div>${body}</div>`;
  }

  async function loadCalendar() {
    const start = state.today?.day_start;
    const end = state.today?.day_end;
    if (!start || !end) throw Error("Authoritative day bounds are unavailable.");
    state.calendar = await api(`/api/fmc/${encodeURIComponent(state.org)}/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    renderCalendar();
  }

  function minuteInZone(iso, timezone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(iso));
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0) % 24;
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
  }

  function hhmm(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function renderCalendar() {
    const rows = [
      ...(state.calendar?.bookings || []).map((row) => ({ ...row, kind: "booking" })),
      ...(state.calendar?.holds || []).map((row) => ({ ...row, status: "held", kind: "hold" })),
      ...(state.calendar?.blocks || []).map((row) => ({ ...row, status: "blocked", kind: "block" })),
    ].sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at));
    const configured = (state.today?.courts || []).filter(hasRateCoverage);
    if (!configured.length) {
      el.timeline.innerHTML = '<p class="muted">No sellable court hours configured for this day.</p>';
      return;
    }
    const start = Math.min(...configured.map((court) => Number(court.open_start_minute)).filter(Number.isFinite));
    const end = Math.max(...configured.map((court) => Number(court.open_end_minute)).filter(Number.isFinite));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      el.timeline.innerHTML = '<p class="muted">No sellable court hours configured for this day.</p>';
      return;
    }
    const steps = [];
    for (let minute = start; minute < end; minute += 30) steps.push(minute);
    const labels = steps.map((minute, index) => index % 2 === 0 ? `<span>${hhmm(minute)}</span>` : "<span></span>").join("");
    const timezone = state.today.timezone;
    const lanes = configured.map((court) => {
      const events = rows.filter((row) => row.court_id === court.court_id).map((row) => ({
        ...row, startMin: minuteInZone(row.starts_at, timezone), endMin: minuteInZone(row.ends_at, timezone),
      }));
      const sellable = court.sellable_windows || [];
      const cells = steps.map((minute) => {
        const open = sellable.some((window) => Number(window.start_minute) <= minute && Number(window.end_minute) > minute);
        if (!open) return `<div class="lane-cell closed" title="${hhmm(minute)} not sellable"></div>`;
        const event = events.find((row) => row.startMin < minute + 30 && row.endMin > minute);
        if (!event) return `<div class="lane-cell open" title="${hhmm(minute)} available"></div>`;
        const kind = event.kind === "block" ? "blocked" : event.kind === "hold" ? "held" : "booked";
        const label = event.startMin >= minute && event.startMin < minute + 30
          ? event.kind === "block" ? "Block" : event.kind === "hold" ? "Hold" : event.status
          : "";
        const source = event.kind === "block" ? (event.reason || "Blocked") : event.kind === "hold" ? "Active booking hold" : event.source || event.status;
        const title = `${hhmm(event.startMin)}–${hhmm(event.endMin)} · ${source}`;
        return `<div class="lane-cell ${kind}" title="${esc(title)}"><span>${esc(label)}</span></div>`;
      }).join("");
      return `<div class="court-lane"><strong>${esc(court.court_name)}</strong><div class="lane-track" style="grid-template-columns:repeat(${steps.length},minmax(22px,1fr))">${cells}</div><em>${esc(court.utilization_pct)}%</em></div>`;
    }).join("");
    el.timeline.innerHTML = `<div class="court-grid"><div class="court-axis"><span>COURT</span><div class="time-axis" style="grid-template-columns:repeat(${steps.length},minmax(22px,1fr))">${labels}</div><span>UTIL.</span></div>${lanes}</div><div class="timeline-legend"><span><i class="legend-open"></i>Available</span><span><i class="legend-booked"></i>Booked</span><span><i class="legend-held"></i>Held</span><span><i class="legend-blocked"></i>Blocked</span><span><i class="legend-closed"></i>Not sellable</span></div>`;
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
    } else if (state.view === "revenue") {
      renderRevenue();
    }
  }));

  el.org.addEventListener("change", () => {
    state.org = el.org.value;
    load();
  });
  el.date.addEventListener("change", load);
  el.refresh.addEventListener("click", load);
  el.signOut.addEventListener("click", () => {
    localStorage.removeItem("fill.access");
    state.token = null;
    showAuth();
  });

  init();
})();
