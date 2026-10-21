(() => {
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const state = { token: null, org: null, orgs: [], view: "today", today: null, calendar: null, demo: false, authEpoch: 0, readEpoch: 0, calendarEpoch: 0, provenanceEpoch: 0, provenancePage: null };
  // Synthetic demo is opt-in and restricted to the separate private-preview host
  // and loopback dev. This NEVER activates on public fillmycourt.com.
  // Also accept the CI's non-production manual draft aliases and immutable
  // Netlify deployment IDs, but never the independent public Fill project.
  const previewHost = /^(?:fillmycourt-preview|(?:(?:deploy-preview-[1-9][0-9]*|fill-pr8-[a-f0-9]{7}|[a-f0-9]{12,})--fillmycourt-preview))\.netlify\.app$/.test(location.hostname || "");
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
    loginForm: q("#operatorSignIn"), loginEmail: q("#operatorEmail"),
    loginPassword: q("#operatorPassword"), loginButton: q("#operatorLoginButton"),
    loginError: q("#operatorLoginError"),
    provenance: q("#provenanceView"), dateToolbar: q("#dateToolbar"),
    provenanceForm: q("#provenanceForm"), connection: q("#provenanceConnection"),
    age: q("#provenanceAge"), review: q("#provenanceReview"),
    provenanceMessage: q("#provenanceMessage"), report: q("#provenanceReport"),
    next: q("#provenanceNext"),
  };

  // Use the venue's Lisbon-local calendar date, not UTC's day (which can lag).
  const localDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const datePart = (type) => localDate.find((part) => part.type === type)?.value;
  el.date.value = [datePart("year"), datePart("month"), datePart("day")].join("-");

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
    // Password login is the ONLY supported staging authentication flow.
    // A URL fragment or legacy localStorage bearer must never create a session.
    // Strip inherited token fragments promptly to avoid accidental leakage.
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (fragment.has("access_token") || fragment.has("refresh_token")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    localStorage.removeItem("fill.access");
    return typeof sessionStorage !== "undefined" ? sessionStorage.getItem("fill.access") : null;
  }

  async function api(path, expectedCalendarEpoch = null, expectedProvenanceEpoch = null) {
    // Demo calls never touch a backend or persist/forward any token.
    if (state.demo) {
      if (!window.FillDemo?.get) throw Error("Synthetic demo dataset unavailable.");
      return window.FillDemo.get(path);
    }
    if (!state.token) throw Error("AUTH_REQUIRED");
    const token = state.token, epoch = state.authEpoch, readEpoch = state.readEpoch;
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    let body = {};
    try { body = await response.json(); } catch {}
    // A response from a previous login must never clear or rehydrate a newer session.
    if (epoch !== state.authEpoch || token !== state.token) throw Error("STALE_SESSION");
    // An older tenant/date read must never revoke the session after navigation.
    if (readEpoch !== state.readEpoch ||
        (expectedProvenanceEpoch !== null &&
          (expectedProvenanceEpoch !== state.provenanceEpoch || state.view !== "provenance")) ||
        (expectedCalendarEpoch !== null &&
          (expectedCalendarEpoch !== state.calendarEpoch || state.view !== "calendar")))
      throw Error("STALE_REQUEST");
    if (!response.ok) {
      if (response.status === 401) invalidateSession();
      const error = Error(body.message || body.error || `Request failed ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showAuth() {
    state.calendarEpoch++;
    resetProvenance(true);
    if (el.provenance) el.provenance.hidden = true;
    if (el.dateToolbar) el.dateToolbar.hidden = false;
    // Hidden nodes are still part of the DOM: remove private data on logout.
    state.today = null;
    state.calendar = null;
    state.org = null;
    state.orgs = [];
    state.view = "today";
    for (const node of [el.kpis, el.util, el.empty, el.timeline,
      el.revenueKpis, el.opportunityQueue, el.courtComparison]) {
      node.innerHTML = "";
    }
    el.org.innerHTML = '<option value="">Choose organisation</option>';
    el.org.value = "";
    el.utilBadge.textContent = "—";
    el.error.hidden = true;
    el.error.textContent = "";
    el.pageTitle.textContent = "Today";
    el.today.hidden = false;
    el.calendar.hidden = true;
    el.revenue.hidden = true;
    qa(".nav-item").forEach(button =>
      button.classList.toggle("active", button.dataset.view === "today"));
    el.auth.hidden = false;
    el.workspace.hidden = true;
    el.signOut.hidden = true;
    el.identity.textContent = "Not signed in";
  }

  function invalidateSession() {
    state.authEpoch++;
    state.readEpoch++;
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("fill.access");
    localStorage.removeItem("fill.access");
    state.token = null;
    showAuth();
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
    if (["STALE_SESSION", "STALE_REQUEST"].includes(error?.message)) return;
    if (!state.demo && !state.token) return;
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
    const org = state.org, day = state.today, authEpoch = state.authEpoch;
    const readEpoch = state.readEpoch, calendarEpoch = ++state.calendarEpoch;
    let calendar;
    try {
      calendar = await api(`/api/fmc/${encodeURIComponent(org)}/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, calendarEpoch);
    } catch (error) {
      // Network failures, unlike HTTP responses, bypass api()'s epoch check.
      // Never show an error from a club/date/session the operator has left.
      if (authEpoch !== state.authEpoch || readEpoch !== state.readEpoch ||
          calendarEpoch !== state.calendarEpoch || state.view !== "calendar" ||
          state.org !== org || state.today !== day) return;
      throw error;
    }
    if (authEpoch !== state.authEpoch || readEpoch !== state.readEpoch ||
        calendarEpoch !== state.calendarEpoch || state.view !== "calendar" ||
        state.org !== org || state.today !== day) return;
    state.calendar = calendar;
    renderCalendar();
  }

  function renderCalendar() {
    const today = state.today || {};
    const dayStart = Date.parse(today.day_start);
    const dayEnd = Date.parse(today.day_end);
    const timezone = today.timezone || "Europe/Lisbon";
    // An authoritative Lisbon day may have 23, 24 or 25 real hours.
    if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) ||
        dayEnd <= dayStart || dayEnd - dayStart < 23 * 3600000 ||
        dayEnd - dayStart > 25 * 3600000) {
      el.timeline.innerHTML = '<p class="muted">Authoritative day bounds are unavailable.</p>';
      return;
    }
    const courts = today.courts || [];
    if (!courts.length) {
      el.timeline.innerHTML = '<p class="muted">No active courts returned for this day.</p>';
      return;
    }
    // The x-axis consists of real 30-minute instants, not wall-clock minute
    // numbers. In autumn the 01:00 hour repeats twice with different offsets.
    const halfHourMs = 30 * 60000;
    const clockChange = dayEnd - dayStart !== 48 * halfHourMs;
    const wallLabel = (millis, withOffset = clockChange) => {
      const instant = new Date(millis);
      const clock = formatTime(instant.toISOString(), timezone);
      if (!withOffset) return clock;
      const name = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone, timeZoneName: "shortOffset",
      }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value || "GMT";
      return clock + " " + name.replace(/^GMT$/, "UTC+0").replace(/^GMT/, "UTC");
    };
    const slots = [];
    for (let ms = dayStart; ms < dayEnd; ms += halfHourMs) {
      slots.push({ start: ms, end: Math.min(ms + halfHourMs, dayEnd),
        label: wallLabel(ms), localMinute: minuteInZone(new Date(ms).toISOString(), timezone) });
    }

    // Core Calendar includes cancelled history. Only booked/pending-payment,
    // active holds and blocks occupy court time. Clip multi-day events in UTC.
    const events = [
      ...(state.calendar?.blocks || []).map((row) => ({...row, kind: "block", status: "blocked"})),
      ...(state.calendar?.bookings || [])
        .filter((row) => ["confirmed", "pending_payment"].includes(row.status))
        .map((row) => ({...row, kind: "booking"})),
      ...(state.calendar?.holds || []).map((row) => ({...row, kind: "hold", status: "held"})),
    ].map((row) => {
      const from = Date.parse(row.starts_at);
      const until = Date.parse(row.ends_at);
      if (!Number.isFinite(from) || !Number.isFinite(until)) return null;
      const first = Math.max(from, dayStart);
      const last = Math.min(until, dayEnd);
      return last > first ? {...row, first, last} : null;
    }).filter(Boolean);

    const axisLabels = slots.map((slot, index) => index % 2 === 0
      ? '<span>' + esc(slot.label) + '</span>' : '<span></span>').join('');
    const lanes = courts.map((court) => {
      const courtEvents = events.filter((row) => row.court_id === court.court_id);
      const windows = (court.sellable_windows || []).map((window) => ({
        ...window,
        first: Date.parse(window.starts_at || ""),
        last: Date.parse(window.ends_at || ""),
      }));
      const cells = slots.map((slot) => {
        // Event wins before rate coverage. A valid booking can be recorded for
        // an unpriced court and must not silently vanish from the calendar.
        const event = courtEvents.find((row) => row.first < slot.end && row.last > slot.start);
        if (event) {
          const kind = event.kind === "block" ? "blocked" : event.kind === "hold" ? "held" : "booked";
          const label = event.first >= slot.start && event.first < slot.end
            ? (event.kind === "block" ? "Block" : event.kind === "hold" ? "Hold" : event.status) : "";
          const source = event.kind === "block" ? event.reason || "Blocked"
            : event.kind === "hold" ? "Active booking hold" : event.source || event.status;
          const endLabel = event.last === dayEnd ? "24:00" : wallLabel(event.last);
          const description = wallLabel(event.first) + "–" + endLabel + " · " + source;
          return '<div class="lane-cell ' + kind + '" title="' + esc(description) + '"><span>' + esc(label) + '</span></div>';
        }
        // Prefer absolute Core tariff-island timestamps. The local-minute
        // fallback is for older/test fixtures, not a transactional booking
        // availability guarantee.
        const covered = windows.some((window) => {
          if (Number.isFinite(window.first) && Number.isFinite(window.last))
            return window.first < slot.end && window.last > slot.start;
          return Number(window.start_minute) <= slot.localMinute &&
            Number(window.end_minute) >= slot.localMinute + 30;
        });
        return covered
          ? '<div class="lane-cell open" title="' + esc(slot.label) + ' — rate-covered; unoccupied in Core"></div>'
          : '<div class="lane-cell closed" title="' + esc(slot.label) + ' — no rate coverage"></div>';
      }).join('');
      const utilisation = hasRateCoverage(court) ? esc(court.utilization_pct) + "%" : "No rate";
      return '<div class="court-lane"><strong>' + esc(court.court_name) +
        '</strong><div class="lane-track" style="grid-template-columns:repeat(' +
        slots.length + ',minmax(22px,1fr))">' + cells + '</div><em>' + utilisation + '</em></div>';
    }).join('');
    const dstNote = clockChange
      ? '<p class="muted calendar-dst-note">Clock change: this local day contains ' +
        (slots.length / 2) + ' hours. UTC offsets distinguish repeated or skipped hours.</p>' : '';
    el.timeline.innerHTML = '<div class="court-grid"><div class="court-axis"><span>COURT</span><div class="time-axis" style="grid-template-columns:repeat(' +
      slots.length + ',minmax(22px,1fr))">' + axisLabels + '</div><span>UTIL.</span></div>' +
      lanes + '</div><div class="timeline-legend"><span><i class="legend-open"></i>Rate-covered / unoccupied</span>' +
      '<span><i class="legend-booked"></i>Booked</span><span><i class="legend-held"></i>Held</span>' +
      '<span><i class="legend-blocked"></i>Blocked</span><span><i class="legend-closed"></i>No rate coverage</span></div>' +
      dstNote + '<p class="muted calendar-footnote">Cancelled or failed bookings do not occupy capacity. ' +
      'Rate coverage does not confirm a new booking can be completed.</p>';
  }

  const evidenceLabels = {
    foreign_booking: "Booking outside the selected organisation",
    missing_receipt_reference: "Receipt reference missing",
    receipt_unavailable: "Receipt missing or inaccessible",
    foreign_receipt: "Receipt belongs to a different connection or organisation",
    invalid_receipt: "Receipt is invalid",
    stale_receipt: "Receipt is too old or expired",
    permission_not_current: "Current permission evidence is not valid",
    permission_changed: "Permission evidence has changed",
    record_not_linked: "Booking is not linked to the source record",
    consistent_internal_evidence: "Internal evidence is consistent — not pilot approval",
  };
  const evidenceUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function resetProvenance(connections = false) {
    state.provenanceEpoch++;
    state.provenancePage = null;
    if (el.report) el.report.textContent = "";
    if (el.provenanceMessage) el.provenanceMessage.textContent = "";
    if (el.next) { el.next.hidden = true; el.next.disabled = false; }
    if (el.review) el.review.disabled = connections;
    if (connections) {
      if (el.connection) el.connection.innerHTML = '<option value="">Choose connection</option>';
      if (el.age) el.age.value = "";
    }
  }

  function evidenceError(error) {
    if (["STALE_SESSION", "STALE_REQUEST"].includes(error?.message)) return;
    if (!state.demo && !state.token) return;
    el.provenanceMessage.textContent = error?.status === 403
      ? "You do not have permission to review evidence for this organisation or connection."
      : "Stored evidence report unavailable. No provider request was made; pilot remains unapproved.";
  }

  async function loadProvenanceConnections() {
    if (!el.connection || !state.org) return;
    const epoch = ++state.provenanceEpoch;
    const org = state.org, auth = state.authEpoch;
    const current = () => epoch === state.provenanceEpoch && org === state.org &&
      auth === state.authEpoch && state.view === "provenance";
    if (state.demo) {
      el.provenanceMessage.textContent = "This synthetic demo contains no provider evidence. No API request was sent.";
      return;
    }
    el.provenanceMessage.textContent = "Loading accessible connections…";
    try {
      const data = await api(`/api/fmc/${encodeURIComponent(org)}/provider-provenance/connections`, null, epoch);
      if (!current()) return;
      if (!Array.isArray(data.items) || data.items.length > 100 ||
          data.items.some(item => !evidenceUUID.test(item.id) || item.provider !== "playtomic"))
        throw Error("INVALID_REPORT");
      el.connection.innerHTML = '<option value="">Choose connection</option>' +
        data.items.map((item, i) => `<option value="${esc(item.id)}">Playtomic · connection ${i + 1}</option>`).join("");
      el.review.disabled = data.items.length === 0;
      el.provenanceMessage.textContent = data.items.length
        ? "Choose a connection and enter the maximum receipt age to review stored evidence."
        : "No supported connection in this organisation. No evidence or pilot readiness is inferred.";
    } catch (error) { if (current()) evidenceError(error); }
  }

  function validEvidencePage(data, age) {
    const flags = item => item?.pilot_ready === false &&
      item.provider_requests_allowed === false && item.can_display_available_slots === false;
    return data?.mode === "read_only_source_review" && flags(data) &&
      data.max_age_seconds === age && typeof data.as_of === "string" &&
      data.as_of.endsWith("Z") && Number.isFinite(Date.parse(data.as_of)) &&
      ["no_shadow_bookings", "needs_review", "page_consistent"].includes(data.status) &&
      Array.isArray(data.items) && data.items.length <= 50 &&
      data.items.every(item => evidenceUUID.test(item.booking_id) &&
        Object.hasOwn(evidenceLabels, item.status) && flags(item)) &&
      new Set(data.items.map(item => item.booking_id)).size === data.items.length &&
      typeof data.has_more === "boolean" &&
      (data.has_more ? data.items.length > 0 && evidenceUUID.test(data.next_after_booking_id) &&
        data.next_after_booking_id === data.items.at(-1).booking_id
        : data.next_after_booking_id === null) &&
      (data.status !== "page_consistent" || (!data.has_more && data.items.length > 0 &&
        data.items.every(item => item.status === "consistent_internal_evidence"))) &&
      (data.status !== "no_shadow_bookings" || (!data.has_more && data.items.length === 0));
  }

  async function loadProvenancePage(after = null) {
    if (!state.org || state.view !== "provenance" || state.demo) return;
    const org = state.org, connection = el.connection.value, ageText = el.age.value;
    const age = Number(ageText);
    if (!evidenceUUID.test(connection) || !/^[1-9][0-9]*$/.test(ageText) ||
        !Number.isInteger(age) || age > 31536000) {
      resetProvenance();
      el.provenanceMessage.textContent = "Choose a connection and a whole-number receipt age from 1 to 31,536,000 seconds.";
      return;
    }
    resetProvenance();
    const epoch = state.provenanceEpoch, auth = state.authEpoch;
    const current = () => epoch === state.provenanceEpoch && auth === state.authEpoch &&
      org === state.org && state.view === "provenance";
    el.review.disabled = true;
    el.next.disabled = true;
    el.provenanceMessage.textContent = "Reviewing stored evidence…";
    try {
      const data = await api(`/api/fmc/${encodeURIComponent(org)}/provider-provenance/${encodeURIComponent(connection)}?max_age_seconds=${age}&limit=50` +
        (after ? `&after_booking_id=${encodeURIComponent(after)}` : ""), null, epoch);
      if (!current()) return;
      if (!validEvidencePage(data, age)) throw Error("INVALID_REPORT");
      state.provenancePage = data;
      const counts = new Map();
      data.items.forEach(item => counts.set(item.status, (counts.get(item.status) || 0) + 1));
      const heading = data.status === "no_shadow_bookings" ? "No stored shadow bookings on this page."
        : data.status === "page_consistent" ? "This page is internally consistent. Pilot remains unapproved."
        : "This page needs review. Pilot remains unapproved.";
      el.provenanceMessage.textContent = heading;
      el.report.innerHTML = `<p>Snapshot: ${esc(data.as_of)} · Maximum age: ${esc(age)} seconds · ${data.items.length} bookings on this page.</p>` +
        (data.has_more ? "<p>More bookings remain. This is not a complete report.</p>" : "<p>End of this page sequence. This is not pilot approval.</p>") +
        [...counts].map(([status, count]) => `<p>${esc(evidenceLabels[status])}: ${count}</p>`).join("") +
        '<ul class="provenance-items">' + data.items.map(item =>
          `<li>${esc(evidenceLabels[item.status])}<small>Internal booking ID: ${esc(item.booking_id)}</small></li>`).join("") + "</ul>";
      el.next.hidden = !data.has_more;
    } catch (error) { if (current()) evidenceError(error); }
    finally { if (current()) { el.review.disabled = false; el.next.disabled = false; } }
  }

  el.provenanceForm?.addEventListener("submit", event => {
    event.preventDefault();
    if (!el.review.disabled) return loadProvenancePage();
  });
  el.next?.addEventListener("click", () => {
    const after = state.provenancePage?.next_after_booking_id;
    if (after && !el.next.disabled) return loadProvenancePage(after);
  });
  el.connection?.addEventListener("change", () => resetProvenance());
  el.age?.addEventListener("input", () => resetProvenance());

  async function load() {
    if (!state.org) return;
    resetProvenance(true);
    const org = state.org, date = el.date.value;
    const authEpoch = state.authEpoch, readEpoch = ++state.readEpoch;
    state.calendarEpoch++;
    // Do not leave a previous organisation's capacity or calendar in the DOM
    // while the newly selected organisation is loading. A late response is
    // separately rejected by auth/read epochs below.
    state.today = null;
    state.calendar = null;
    [el.kpis, el.util, el.empty, el.revenueKpis, el.opportunityQueue,
      el.courtComparison, el.timeline].forEach((node) => { node.textContent = ""; });
    el.utilBadge.textContent = "—";
    clearError();
    if (state.view === "provenance") return loadProvenanceConnections();
    try {
      const today = await api(`/api/fmc/${encodeURIComponent(org)}/today?date=${encodeURIComponent(date)}`);
      if (authEpoch !== state.authEpoch || readEpoch !== state.readEpoch ||
          state.org !== org || date !== el.date.value) return;
      state.today = today;
      state.calendar = null;
      renderToday();
      if (state.view === "calendar") await loadCalendar();
    } catch (error) {
      if (authEpoch === state.authEpoch && readEpoch === state.readEpoch) fail(error);
    }
  }

  async function init() {
    // Each new login supersedes every outstanding request of the former operator.
    const authEpoch = ++state.authEpoch;
    state.readEpoch++;
    state.token = state.demo ? null : session();
    if (!state.demo && !state.token) return showAuth();
    try {
      const me = await api("/api/me");
      if (authEpoch !== state.authEpoch) return;
      el.identity.textContent = state.demo ? "SYNTHETIC DEMO — no account" : (me.user?.email || "Signed in");
      if (state.demo) el.signOut.textContent = "Exit demo";
      const organizations = await api("/api/fmc/organizations");
      if (authEpoch !== state.authEpoch) return;
      state.orgs = organizations.items || [];
      el.org.innerHTML = state.orgs.map((org) => (
        `<option value="${esc(org.id)}">${esc(org.name)} · ${esc(org.role)}</option>`
      )).join("") || '<option value="">No organisation access</option>';
      state.org = state.orgs[0]?.id || null;
      showWorkspace();
      if (state.org) await load();
      else if (!state.demo) fail(Error("No operator club role assigned. Ask the administrator."));
    } catch (error) {
      if (authEpoch === state.authEpoch) fail(error);
    }
  }

  qa(".nav-item").forEach((button) => button.addEventListener("click", async () => {
    resetProvenance(true);
    clearError();
    if (button.dataset.view !== "calendar") state.calendarEpoch++;
    state.view = button.dataset.view;
    qa(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
    el.pageTitle.textContent = state.view === "today" ? "Today" : state.view === "calendar" ? "Calendar" : state.view === "provenance" ? "Provider evidence" : "Revenue & Capacity";
    el.today.hidden = state.view !== "today";
    el.calendar.hidden = state.view !== "calendar";
    el.revenue.hidden = state.view !== "revenue";
    if (el.provenance) el.provenance.hidden = state.view !== "provenance";
    if (el.dateToolbar) el.dateToolbar.hidden = state.view === "provenance";
    if (state.view === "provenance") await loadProvenanceConnections();
    if (state.view === "calendar") {
      try { await loadCalendar(); } catch (error) { fail(error); }
    }
  }));

  el.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.demo) return;
    if (el.loginButton.disabled) return;
    el.loginError.hidden = true;
    el.loginError.textContent = "";
    el.loginButton.disabled = true;
    const password = el.loginPassword.value;
    try {
      const result = await fetch("/api/fmc-auth/login", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: {"content-type":"application/json"},
        body: JSON.stringify({email:el.loginEmail.value.trim(),password})
      });
      if (!result.ok) throw Error("Login failed. Check your operator credentials.");
      const data = await result.json();
      if (typeof data.access_token !== "string") throw Error("Login unavailable.");
      // Browser-session only, no token in the URL or persistent localStorage.
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem("fill.access", data.access_token);
      localStorage.removeItem("fill.access");
      el.loginPassword.value = "";
      await init();
    } catch {
      el.loginPassword.value = "";
      el.loginError.textContent = "Unable to sign in. Check your credentials or contact the administrator.";
      el.loginError.hidden = false;
    } finally {
      el.loginButton.disabled = false;
    }
  });

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
    invalidateSession();
  });

  init();
})();
