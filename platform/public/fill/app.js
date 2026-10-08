(() => {
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const state = { token: null, org: null, orgs: [], view: "today", today: null, calendar: null, courts: [], opportunities: null };
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

  async function api(path, options = {}) {
    if (!state.token) throw Error("AUTH_REQUIRED");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${state.token}`);
    const response = await fetch(path, { ...options, headers });
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
      state.opportunities = null;
      renderToday();
      if (state.view === "calendar") await loadCalendar();
      if (state.view === "revenue") await loadOpportunities();
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

  async function loadOpportunities() {
    if (!state.org) return;
    const date = el.date.value;
    const result = await api(
      `/api/fmc/${encodeURIComponent(state.org)}/opportunities/evaluate?date=${encodeURIComponent(date)}`,
      { method: "POST" }
    );
    state.opportunities = result;
    renderRevenue();
  }

  function renderCrmShadow(target, result) {
    const action = result.action || {};
    const shadow = result.shadow || {};
    const waves = shadow.waves || [];
    const exclusions = shadow.exclusions || {};
    const exclusionText = Object.entries(exclusions)
      .map(([reason, count]) => `${count} ${reason.replaceAll("_", " ")}`)
      .join(" · ");
    target.innerHTML = `<div class="crm-shadow-summary">
      <div><span>SHADOW PLAN</span><strong>${esc(action.audience_eligible || 0)} eligible · ${esc(action.audience_blocked || 0)} blocked</strong></div>
      <small>${esc(waves.length)} audience wave${waves.length === 1 ? "" : "s"} · WhatsApp primary / Email fallback</small>
      ${exclusionText ? `<small>Excluded: ${esc(exclusionText)}</small>` : ""}
      <small class="crm-safety">Execution disabled. No messages, bookings, prices or provider data are written.</small>
      ${Number(action.audience_eligible || 0) > 0 && action.status === "shadow_ready"
        ? `<button class="button secondary crm-approval-request" data-action-id="${esc(action.id)}">Request approval</button>`
        : ""}
    </div>`;
  }

  function renderRevenue() {
    if (!state.today || !el.revenueKpis || !el.opportunityQueue) return;
    const summary = state.today.summary || {};
    const currency = state.today.currency || "EUR";
    const windows = [...(state.today.empty_windows || [])];
    const opportunitySummary = state.opportunities?.summary || {};
    const opportunities = state.opportunities?.items || [];
    const actionable = Number(opportunitySummary.actionable || 0);
    const expectedIncremental = Number(opportunitySummary.expected_incremental_contribution_minor || 0);
    const uncovered = Number(summary.courts_without_rate_coverage || 0);

    renderKpis(el.revenueKpis, [
      ["Revenue today", mon(summary.revenue_minor, currency), "Confirmed + pending payment"],
      ["Utilisation", `${summary.utilization_pct || 0}%`, "Booked / sellable capacity"],
      ["Actionable", actionable, "Demand-aware revenue opportunities"],
      ["Expected incremental", mon(expectedIncremental, currency), "Rule-based expected uplift"],
      ["Rate coverage", rateCoverageSummary(summary), uncovered ? `${uncovered} court needs attention` : "All active courts covered"],
    ]);

    const timezone = state.today.timezone || "Europe/Lisbon";
    const formatTime = (iso) => iso ? new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso)) : "—";
    const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;

    if (!state.opportunities) {
      el.opportunityQueue.innerHTML = '<p class="muted">Evaluating demand, organic baseline and incremental contribution…</p>';
    } else {
      el.opportunityQueue.innerHTML = opportunities.slice(0, 20).map((opportunity, index) => {
        const sources = opportunity.source_breakdown || {};
        const getDemand = Number(sources.getacourt_network?.active_intents || 0);
        const clubSignal = sources.club_owned?.signal_status === "connected"
          ? `${Number(sources.club_owned?.active_intents || 0)} club-owned`
          : "Club CRM signal not connected";
        const action = (opportunity.action_plan || [])[0];
        const status = String(opportunity.status || "detected");
        const signal = sources.demand_level || "none";
        const expected = mon(opportunity.expected_incremental_contribution_minor || 0, opportunity.currency || currency);
        const quote = mon(opportunity.quote_amount_minor || 0, opportunity.currency || currency);
        const timing = `${formatTime(opportunity.recommended_starts_at)} · ${opportunity.duration_minutes || "—"} min`;
        const actionText = action
          ? action.action.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase())
          : "No intervention recommended";
        return `<article class="opportunity-card status-${esc(status)}">
          <div class="opportunity-card-head">
            <div class="opportunity-main">
              <span class="opportunity-rank">#${index + 1}</span>
              <div>
                <div class="opportunity-title-line"><strong>${esc(opportunity.court_name || "Court")}</strong><span class="opportunity-status">${esc(status)}</span></div>
                <small>${esc(timing)} · ${esc(opportunity.venue_name || "")}</small>
              </div>
            </div>
            <div class="opportunity-value">
              <strong>${esc(expected)}</strong>
              <span>EXPECTED INCREMENTAL</span>
              <small>${esc(quote)} slot value</small>
            </div>
          </div>
          <div class="opportunity-metrics">
            <span><b>${esc(opportunity.active_demand_count || 0)}</b> active intents</span>
            <span><b>${esc(Math.round(Number(opportunity.demand_fit_score || 0)))}</b>/100 demand fit</span>
            <span><b>${esc(signal)}</b> demand</span>
            <span><b>${esc(pct(opportunity.organic_baseline_probability))}</b> organic baseline</span>
            <span><b>${esc(Math.round(Number(opportunity.priority_score || 0)))}</b>/100 priority</span>
          </div>
          <div class="opportunity-sources">
            <span>GetACourt network: <b>${esc(getDemand)}</b></span>
            <span>${esc(clubSignal)}</span>
          </div>
          <div class="opportunity-action"><span>RECOMMENDED</span><strong>${esc(actionText)}</strong><small>Recommendation only · no automatic pricing, messaging or provider writes.</small></div>
          ${status === "actionable" || status === "in_progress"
            ? `<div class="crm-shadow-controls"><button class="button secondary crm-shadow-button" data-opportunity-id="${esc(opportunity.id)}">Prepare CRM shadow</button><div class="crm-shadow-result"></div></div>`
            : ""}
        </article>`;
      }).join("") || '<p class="muted">No demand-aware revenue opportunities for this date.</p>';
    }

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

  el.opportunityQueue?.addEventListener("click", async (event) => {
    const shadowButton = event.target.closest(".crm-shadow-button");
    if (shadowButton) {
      const card = shadowButton.closest(".opportunity-card");
      const target = card?.querySelector(".crm-shadow-result");
      if (!target) return;
      shadowButton.disabled = true;
      shadowButton.textContent = "Preparing…";
      try {
        const result = await api(
          `/api/fmc/${encodeURIComponent(state.org)}/opportunities/${encodeURIComponent(shadowButton.dataset.opportunityId)}/crm-shadow`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        );
        renderCrmShadow(target, result);
        shadowButton.textContent = "Rebuild CRM shadow";
      } catch (error) {
        target.innerHTML = `<p class="crm-shadow-error">${esc(error.message || String(error))}</p>`;
        shadowButton.textContent = "Prepare CRM shadow";
      } finally {
        shadowButton.disabled = false;
      }
      return;
    }

    const requestButton = event.target.closest(".crm-approval-request");
    if (requestButton) {
      requestButton.disabled = true;
      try {
        const result = await api(
          `/api/fmc/${encodeURIComponent(state.org)}/crm-actions/${encodeURIComponent(requestButton.dataset.actionId)}/request-approval`,
          { method: "POST" }
        );
        requestButton.outerHTML = `<button class="button primary crm-approval-approve" data-action-id="${esc(requestButton.dataset.actionId)}">Approve plan · no send</button><small class="crm-approval-state">${esc(result.status)}</small>`;
      } catch (error) {
        requestButton.insertAdjacentHTML("afterend", `<small class="crm-shadow-error">${esc(error.message || String(error))}</small>`);
        requestButton.disabled = false;
      }
      return;
    }

    const approveButton = event.target.closest(".crm-approval-approve");
    if (approveButton) {
      approveButton.disabled = true;
      try {
        const result = await api(
          `/api/fmc/${encodeURIComponent(state.org)}/crm-actions/${encodeURIComponent(approveButton.dataset.actionId)}/approve`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve" }) }
        );
        approveButton.outerHTML = `<span class="crm-approved">Approved · execution still disabled</span><small class="crm-approval-state">${esc(result.status)}</small>`;
      } catch (error) {
        approveButton.insertAdjacentHTML("afterend", `<small class="crm-shadow-error">${esc(error.message || String(error))}</small>`);
        approveButton.disabled = false;
      }
    }
  });

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
      try { await loadOpportunities(); } catch (error) { fail(error); }
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
