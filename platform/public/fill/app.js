(() => {
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const state = { token: null, org: null, orgs: [], view: "today", today: null, calendar: null, demo: false, authEpoch: 0, readEpoch: 0, calendarEpoch: 0, provenanceEpoch: 0, provenancePage: null, preflightEpoch: 0, reviewSummary: {preflight: null, provenance: null} };
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
    preflightForm: q("#preflightForm"), operationsSha: q("#operationsSha"),
    preflightCheck: q("#preflightCheck"), preflightMessage: q("#preflightMessage"),
    preflightReport: q("#preflightReport"),
    reviewSummary: q("#clubReviewSummary"),
    uatBlockers: q("#clubUatBlockers"),
    acceptanceForm: q("#acceptanceForm"), acceptanceSha: q("#acceptanceSha"),
    acceptanceFile: q("#acceptanceFile"), acceptanceReview: q("#acceptanceReview"),
    acceptanceMessage: q("#acceptanceMessage"), acceptanceReport: q("#acceptanceReport"),
    acceptanceSummary: q("#acceptanceSummary"),
    clubNextSteps: q("#clubNextSteps"), candidateNextSteps: q("#candidateNextSteps"),
    clubGoRequest: q("#clubGoRequest"), candidateGoRequests: q("#candidateGoRequests"),
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

  async function api(path, expectedCalendarEpoch = null, expectedProvenanceEpoch = null, expectedPreflightEpoch = null) {
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
        (expectedPreflightEpoch !== null &&
          (expectedPreflightEpoch !== state.preflightEpoch || state.view !== "provenance")) ||
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

  // Presentation of the two existing manual reads only. No request, combined
  // readiness decision, page accumulation, storage or inferred freshness here.
  function renderReviewSummary() {
    syncGoPackages();
    renderAcceptanceSummary();
    if (!el.reviewSummary) return;
    if (state.view !== "provenance" || !state.org || (!state.demo && !state.token)) {
      el.reviewSummary.textContent = "";
      if (el.uatBlockers) el.uatBlockers.textContent = "";
      if (el.clubNextSteps) el.clubNextSteps.textContent = "";
      if (el.clubGoRequest) el.clubGoRequest.textContent = "";
      return;
    }
    const scoped = key => {
      const item = state.reviewSummary[key];
      return item?.org === state.org && item.auth === state.authEpoch ? item : null;
    };
    const preflight = scoped("preflight"), provenance = scoped("provenance");
    const club = state.orgs.find(item => item.id === state.org);
    const labels = {
      not_requested: "Not checked or reviewed. Use the explicit controls below.",
      loading: "Read in progress. No previous result is retained.",
      loading_connections: "Loading accessible connections; receipts have not been reviewed.",
      select_parameters: "Not reviewed. Choose a connection and enter a receipt-age threshold below.",
      no_connections: "No supported connections returned. No readiness is inferred.",
      denied: "Access denied for this read. No evidence or readiness is inferred.",
      unavailable: "Unavailable or incompatible. No evidence or readiness is inferred.",
      demo: "Absent in the synthetic demo. No API request was sent.",
    };
    let operations = `<p>${esc(labels[preflight?.status] || labels.not_requested)}</p>`;
    if (preflight?.status === "passed" || preflight?.status === "blocked") {
      operations = `<p><strong>${preflight.status === "passed" ? "Operations checks passed — not UAT approval" : "Operations checks blocked"}</strong></p>` +
        `<p>${preflight.blocked} of 10 checks blocked; 6 gates not assessed.</p>` +
        `<p>Snapshot: ${esc(preflight.asOf)}</p><p>Expected Operations SHA: <code>${esc(preflight.expected)}</code></p>` +
        `<p>Reported runtime SHA: <code>${esc(preflight.runtime || "Not reported")}</code></p>` +
        "<p>Self-reported build metadata, not independent runtime identity.</p>";
    }
    let receipts = `<p>${esc(labels[provenance?.status] || labels.not_requested)}</p>`;
    if (provenance?.status === "reviewed") {
      const title = provenance.result === "page_consistent" ? "Page internally consistent — not pilot approval"
        : provenance.result === "no_shadow_bookings" ? "No stored shadow bookings on this page"
        : "Page needs review or is incomplete";
      receipts = `<p><strong>${title}</strong></p><p>Snapshot: ${esc(provenance.asOf)}</p>` +
        `<p>Playtomic connection: <code>${esc(provenance.connection)}</code></p>` +
        `<p>Maximum receipt age: ${provenance.age} seconds.</p>` +
        `<p>Reviewed bookings on this page: ${provenance.count}; internally consistent: ${provenance.consistent}; need review: ${provenance.count - provenance.consistent}.</p>` +
        `<p>${provenance.continuation ? "Continuation page" : "First page"} only. ${provenance.hasMore ? "More pages remain." : "No more pages after this snapshot."} Not a complete club report.</p>`;
    }
    el.reviewSummary.innerHTML = `<p>Selected club: <strong>${esc(club?.name || "Selected organisation")}</strong></p>` +
      `<p class="muted">Organisation ID: ${esc(state.org)}</p>` +
      '<div class="review-summary-grid"><section><h3>Operations preflight</h3>' + operations +
      '</section><section><h3>Provenance · latest page only</h3>' + receipts + '</section></div>';
    renderUatBlockers(preflight, provenance);
  }

  function renderUatBlockers(preflight, provenance) {
    renderClubNextSteps(preflight, provenance);
    if (!el.uatBlockers) return;
    const observed = [];
    const incomplete = {
      not_requested: "Not read with explicit parameters.",
      loading: "Read in progress; no completed result.",
      loading_connections: "Connections loading; receipts have not been reviewed.",
      select_parameters: "Connection and receipt-age threshold not yet reviewed.",
      no_connections: "No supported connections returned; required evidence is not established.",
      denied: "Access denied for this read; no evidence established.",
      unavailable: "Read unavailable or incompatible; no evidence established.",
      demo: "Absent in the synthetic demo; no real evidence established.",
    };
    const add = (id, label) => observed.push(`<li data-blocker="${esc(id)}">${esc(label)}</li>`);
    if (!["passed", "blocked"].includes(preflight?.status)) {
      add("operations-read", "Operations: " + (incomplete[preflight?.status] || incomplete.not_requested));
    } else {
      preflight.blockedChecks.forEach(key =>
        add("operations-" + key, "Operations: " + preflightChecks[key] + " — blocked in the snapshot."));
    }
    if (provenance?.status !== "reviewed") {
      add("provenance-read", "Provenance: " + (incomplete[provenance?.status] || incomplete.not_requested));
    } else {
      if (provenance.count === 0)
        add("provenance-empty", "Provenance: empty reviewed page; no receipt evidence established on this page.");
      provenance.issues.forEach(({status, count}) => add("provenance-" + status,
        "Provenance: " + evidenceLabels[status] + " — " + count + " on the latest page only."));
      if (provenance.hasMore)
        add("provenance-more-pages", "Provenance: more pages remain; latest-page counts are not a complete report.");
      if (provenance.result === "needs_review" && provenance.count > 0 && !provenance.issues.length && !provenance.hasMore)
        add("provenance-unresolved", "Provenance: page still reports needs review; no clearance is inferred.");
    }
    el.uatBlockers.innerHTML = '<h4>Observed failures or incomplete reads</h4>' +
      (observed.length ? '<ul class="uat-blocker-list">' + observed.join("") + '</ul>'
        : '<p>No failing check or receipt issue in these two last-read snapshots. Unverified gates remain open; this is not UAT clearance.</p>') +
      '<h4>Still unverified — not assessed here</h4><ul class="uat-blocker-list">' +
      Object.entries(preflightNotAssessed).map(([key, label]) =>
        `<li data-unassessed="${esc(key)}">${esc(label)} — not assessed here.</li>`).join("") +
      '<li data-unassessed="club_provenance_coverage">Club-wide provenance coverage — not assessed by a single-page viewer.</li></ul>';
  }

  // Selectable text only: no editor, recipient, clipboard, transport or authority.
  function goRequestText(id, title, lines) {
    return `<details class="go-request" data-go-template="${esc(id)}"><summary>${esc(title)}</summary>` +
      '<p class="read-only-notice">UNSENT DRAFT · NOT GO. Unfilled or unverified fields mean STOP. No approval is recorded here.</p>' +
      `<pre class="go-request-text" tabindex="0" aria-label="${esc(title)} — read-only text">${esc(lines.join("\n"))}</pre></details>`;
  }

  // Club-only planning from the two scoped reads; no candidate GO enters this list.
  function renderClubNextSteps(preflight, provenance) {
    renderClubGoRequest(preflight);
    if (!el.clubNextSteps) return;
    if (state.view !== "provenance" || !state.org || (!state.demo && !state.token)) {
      el.clubNextSteps.textContent = "";
      return;
    }
    if (state.demo) {
      el.clubNextSteps.textContent = "Synthetic demo has no club GO or real evidence. No club-specific next step or permission is established.";
      return;
    }
    const steps = [];
    if (preflight?.status !== "passed") steps.push(["club-operations",
      "Operations reviewer: document the selected club, exact approved Operations SHA and independent isolated-runtime evidence for the unread or blocked prerequisites. Do not repair, provision or run hosted checks here."]);
    steps.push(["club-provenance", provenance?.status === "reviewed"
      ? "Evidence reviewer: document approved freshness policy and club-wide provenance coverage. The reviewed page is not complete club evidence; unresolved receipts stay unresolved without provider fetch, privileged access or repair."
      : "Evidence reviewer: prepare an authorised existing-record provenance review with explicit connection, freshness policy and club-wide coverage. No evidence is established by this list; do not fetch a provider or repair receipts."]);
    steps.push(["club-uat-go",
      "Club release authority: prepare and independently verify a separate club UAT GO with organisation scope, exact Operations SHA, independent runtime identity, existing protected deploy ID/origin, fixture/isolation evidence, consenting testers/roles, two authorised synthetic organisations, read-only routes, access-denial cases, expiry and stop conditions. Unknown evidence or authority means stop; this screen grants nothing."]);
    steps.push(["club-pilot-go",
      "Pilot owner: document named club consent and provider-specific API rights from already authorised records, then obtain separate pilot GO. A UAT GO or GetACourt report cannot authorise pilot execution, live provider access, bookings or payments. No outreach or credential collection here."]);
    el.clubNextSteps.innerHTML = `<p>Club-only planning scope: <code>${esc(state.org)}</code>. Club GO is not verified here.</p>` +
      '<ol class="go-next-list">' + steps.map(([id, text]) =>
        `<li data-club-next="${id}">${esc(text)}</li>`).join("") + "</ol>";
  }

  function renderClubGoRequest(preflight) {
    if (!el.clubGoRequest) return;
    el.clubGoRequest.textContent = "";
    if (state.view !== "provenance" || !state.org || !state.token || state.demo) return;
    if (!state.orgs.some(org => org.id === state.org && ["owner", "admin"].includes(org.role))) {
      el.clubGoRequest.textContent = "Owner/admin scope required. No club request template in this scope.";
      return;
    }
    const observed = preflight?.org === state.org && preflight.auth === state.authEpoch &&
      ["passed", "blocked"].includes(preflight.status) && operationsSHA.test(preflight.expected);
    el.clubGoRequest.innerHTML = goRequestText("club-uat", "View unsent club UAT GO request template", [
      "UNSENT REQUEST DRAFT — NOT AN APPROVAL",
      "Subject: Request separate club GO — protected read-only provenance UAT only",
      "Selected organisation: " + state.org,
      "Operations SHA: " + (observed ? preflight.expected + " (last-read expected value, NOT approved or independently attested)" : "[REQUIRED: exact approved Operations SHA; not the Fill or Get SHA]"),
      "Approver / delegation: [REQUIRED: independently verify original authority; no recipient assigned]",
      "Existing protected nonproduction deploy ID / origin and exact SHA binding: [REQUIRED]",
      "Independent runtime identity, isolation and access receipts: [REQUIRED; self-reported metadata is insufficient]",
      "Two authorised synthetic organisations / consenting testers and roles: [REQUIRED; no personal data or credentials here]",
      "Requested scope: existing-record GET-only Operations preflight and provenance review; two-org isolation, unauthenticated and wrong-role/cross-org access-denial cases only.",
      "Exact route allowlist, connection, approved receipt-age policy and club-wide coverage: [REQUIRED: verify separately; one page is not club coverage]",
      "Current evidence references and unresolved blockers: [REQUIRED: review separately; this draft clears none]",
      "Approval time / expiry / revocation record / stop conditions: [REQUIRED; stop on mismatch, missing evidence, denied access or changed scope]",
      "Excluded: pilot execution or pilot GO, provider requests/credentials/availability, provisioning, repair, deploy, production, OAuth/location state changes, worker activation, bookings/payments and outreach.",
      "Request independent review only. Do not start UAT before separately documented exact-scope GO. This MVP neither sends this draft nor verifies or records GO.",
    ]);
  }

  function setReviewSummary(key, status, details = {}) {
    state.reviewSummary[key] = { ...details, status, org: state.org, auth: state.authEpoch };
    renderReviewSummary();
  }

  function resetProvenance(connections = false) {
    state.provenanceEpoch++;
    state.provenancePage = null;
    if (el.report) el.report.textContent = "";
    if (el.provenanceMessage) el.provenanceMessage.textContent = "";
    if (el.next) { el.next.hidden = true; el.next.disabled = false; }
    if (el.review) el.review.disabled = connections;
    if (connections) {
      resetAcceptance(true);
      resetPreflight(true);
      if (el.connection) el.connection.innerHTML = '<option value="">Choose connection</option>';
      if (el.age) el.age.value = "";
    }
    setReviewSummary("provenance", state.demo ? "demo" : "not_requested");
  }

  function evidenceError(error) {
    if (["STALE_SESSION", "STALE_REQUEST"].includes(error?.message)) return;
    if (!state.demo && !state.token) return;
    setReviewSummary("provenance", error?.status === 403 ? "denied" : "unavailable");
    el.provenanceMessage.textContent = error?.status === 403
      ? "You do not have permission to review evidence for this organisation or connection."
      : "Stored evidence report unavailable. No provider request was made; pilot remains unapproved.";
  }

  async function loadProvenanceConnections() {
    if (!el.connection || !state.org) return;
    resetAcceptance(true);
    const epoch = ++state.provenanceEpoch;
    const org = state.org, auth = state.authEpoch;
    const current = () => epoch === state.provenanceEpoch && org === state.org &&
      auth === state.authEpoch && state.view === "provenance";
    if (state.demo) {
      setReviewSummary("provenance", "demo");
      setReviewSummary("preflight", "demo");
      el.provenanceMessage.textContent = "This synthetic demo contains no provider evidence. No API request was sent.";
      return;
    }
    el.provenanceMessage.textContent = "Loading accessible connections…";
    setReviewSummary("provenance", "loading_connections");
    try {
      const data = await api(`/api/fmc/${encodeURIComponent(org)}/provider-provenance/connections`, null, epoch);
      if (!current()) return;
      if (!Array.isArray(data.items) || data.items.length > 100 ||
          data.items.some(item => !evidenceUUID.test(item.id) || item.provider !== "playtomic"))
        throw Error("INVALID_REPORT");
      el.connection.innerHTML = '<option value="">Choose connection</option>' +
        data.items.map((item, i) => `<option value="${esc(item.id)}">Playtomic · connection ${i + 1}</option>`).join("");
      el.review.disabled = data.items.length === 0;
      setReviewSummary("provenance", data.items.length ? "select_parameters" : "no_connections");
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
    setReviewSummary("provenance", "loading");
    try {
      const data = await api(`/api/fmc/${encodeURIComponent(org)}/provider-provenance/${encodeURIComponent(connection)}?max_age_seconds=${age}&limit=50` +
        (after ? `&after_booking_id=${encodeURIComponent(after)}` : ""), null, epoch);
      if (!current()) return;
      if (!validEvidencePage(data, age)) throw Error("INVALID_REPORT");
      state.provenancePage = data;
      setReviewSummary("provenance", "reviewed", {result: data.status, asOf: data.as_of,
        connection, age, count: data.items.length,
        consistent: data.items.filter(item => item.status === "consistent_internal_evidence").length,
        issues: Object.keys(evidenceLabels).filter(status => status !== "consistent_internal_evidence")
          .map(status => ({status, count: data.items.filter(item => item.status === status).length}))
          .filter(item => item.count > 0),
        continuation: after !== null, hasMore: data.has_more});
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

  const operationsSHA = /^[0-9a-f]{40}$/;
  // Strict report-v1 presentation contract derived from Get 79977c8.
  // This is NOT the evaluator, an evidence fetcher, a GO verifier or a runner.
  const acceptanceCatalog = [
    ["hosted-perimeter", "Hosted access perimeter", ["source-ci", "isolation"], ["anonymous-preview-root-get-no-redirect-no-body"]],
    ["hosted-ui", "Hosted fixture UI", ["source-ci", "isolation", "perimeter"], ["team-login", "fixture-ui-read-only"]],
    ["ios-safari", "Physical iOS / Safari", ["source-ci", "isolation", "perimeter", "ios-device"], ["team-login", "fixture-ui-read-only", "physical-ios-safari", "install-ui-observation"]],
    ["android-chrome", "Physical Android / Chrome", ["source-ci", "isolation", "perimeter", "android-device"], ["team-login", "fixture-ui-read-only", "physical-android-chrome", "install-ui-observation"]],
    ["device-location", "Device location permission", ["source-ci", "isolation", "perimeter", "location-consent"], ["team-login", "fixture-ui-read-only", "device-location-permission-once"]],
    ["google-oauth", "Google OAuth", ["source-ci", "isolation", "perimeter", "oauth-config", "oauth-consent"], ["team-login", "staging-google-login", "create-test-user-session", "refresh-own-test-session", "sign-out-own-test-session"]],
    ["human-accessibility", "Human accessibility", ["source-ci", "isolation", "perimeter", "assistive-device"], ["team-login", "fixture-ui-read-only", "human-keyboard-screen-reader"]],
  ];
  const acceptanceReasons = {
    INVALID_REVIEW_CONTEXT: "Review context invalid",
    INVALID_INPUT: "Input incompatible",
    CANDIDATE_NOT_EXACT_OPEN_DRAFT: "Candidate is not the exact open Draft source",
    MISSING_INVALID_STALE_OR_FOREIGN_DEPLOYMENT: "Exact existing protected deploy receipt missing, invalid, stale or foreign",
    INVALID_RECORD_COLLECTION: "Evidence / GO collection invalid",
    UNKNOWN_OR_MALFORMED_RECORD: "Unknown or malformed evidence / GO record",
    DUPLICATE_RECORD: "Duplicate or conflicting records",
    EXACT_SCOPED_GO_REQUIRED: "Exact scoped GO record missing or invalid",
    TESTER_CONSENT_MISMATCH: "Tester consent does not match the GO record",
  };
  let acceptanceEpoch = 0, acceptanceSnapshot = null;
  function acceptanceAllowed() {
    return !state.demo && Boolean(state.token) && state.view === "provenance" &&
      state.orgs.some(org => org.id === state.org && ["owner", "admin"].includes(org.role));
  }
  // Candidate-only planning, not an execution queue or a grant of authority.
  function renderCandidateNextSteps(snapshot = null, status = "not_reviewed") {
    renderCandidateGoRequests(snapshot, status);
    if (!el.candidateNextSteps) return;
    if (state.view !== "provenance" || !state.org || (!state.demo && !state.token)) {
      el.candidateNextSteps.textContent = "";
      return;
    }
    if (!acceptanceAllowed()) {
      el.candidateNextSteps.textContent = "Signed-in owner/admin local review is required. No candidate-specific GO step or authority is established in this scope.";
      return;
    }
    const reviewed = status === "reviewed" && snapshot;
    const steps = [];
    if (!reviewed) steps.push(["candidate-report",
      "Get release reviewer: explicitly review a fresh, bounded, nonsecret local preflight report for the intended full Get SHA. No current reviewed candidate snapshot means no missing-GO selection can be inferred. No automatic download or check."]);
    steps.push(["candidate-deploy-evidence",
      "Hosting owner: document an existing protected non-production deploy ID/origin bound to the exact Get source SHA, with isolation and access receipts. Unknown or mismatched deployment means stop. A new deploy needs separate deployment GO first; do not deploy from this list."]);
    steps.push(["candidate-authority",
      "Get release authority: independently verify original approval/delegation, exact SHA/deploy/action scope, consenting testers/accounts/devices, approval time, expiry/revocation and stop conditions. A local JSON record or green CI is not authority."]);
    let specific = "";
    if (reviewed) {
      specific = snapshot.rows.map((row, index) => row.missingGo
        ? `<li data-candidate-go="${acceptanceCatalog[index][0]}">Prepare or revalidate separate Get GO: <strong>${esc(acceptanceCatalog[index][1])}</strong>. Exact action scope: ${esc(acceptanceCatalog[index][3].join(", "))}. NOT_RUN.</li>` : "").join("");
      if (snapshot.rows.some(row => row.blocked)) steps.push(["candidate-blocked-evidence",
        "Evidence reviewer: record unresolved candidate checks using authorised existing receipts only; no live provider request, repair or configuration change is authorised. A missing GO flag and missing evidence are separate conditions."]);
      if (!specific) steps.push(["candidate-unverified-go",
        "No missing-record flag in this snapshot, but no GO is verified. Original scoped approvals and current evidence still require independent human review; do not execute."]);
    }
    steps.push(["candidate-state-change-go",
      "OAuth and device-location permissions need separate explicit state-change GO. Worker activation, club/pilot GO and provider rights are not included. No auth/provider request, credential handling, booking or payment is permitted by this list."]);
    el.candidateNextSteps.innerHTML = (reviewed
      ? `<p>Get-only planning scope: <code>${esc(snapshot.sha)}</code>. No club GO or verified execution permission.</p>`
      : "<p>No current candidate-specific plan from a reviewed snapshot. Planning only; no verified Get GO.</p>") +
      '<ol class="go-next-list">' + steps.map(([id, text]) =>
        `<li data-candidate-next="${id}">${esc(text)}</li>`).join("") + specific + "</ol>";
  }

  function renderCandidateGoRequests(snapshot, status) {
    if (!el.candidateGoRequests) return;
    el.candidateGoRequests.textContent = "";
    if (state.view !== "provenance" || !state.org || (!state.demo && !state.token)) return;
    if (!acceptanceAllowed() || status !== "reviewed" || !snapshot) {
      el.candidateGoRequests.textContent = "No current owner/admin-reviewed candidate snapshot. Review a fresh local report first; no candidate-specific request template is inferred.";
      return;
    }
    const drafts = snapshot.rows.map((row, index) => {
      if (!row.missingGo) return "";
      const [id, label, kinds, actions] = acceptanceCatalog[index];
      return goRequestText(id, "View unsent GetACourt GO request — " + label, [
        "UNSENT REQUEST DRAFT — NOT AN APPROVAL",
        "Subject: Request separate GetACourt GO — " + label,
        "Get SHA: " + snapshot.sha + " (imported local snapshot, NOT independently attested)",
        "Report time: " + snapshot.asOf + "; execution NOT_RUN; verified GO NONE.",
        "Check: " + id + "; one check per separate GO, not a combined release request.",
        "Exact requested action allowlist: " + actions.join(", "),
        "Required existing evidence kinds: " + kinds.join(", "),
        "Approver / delegation: [REQUIRED: independently verify original authority; no recipient assigned]",
        "Existing protected nonproduction deploy ID / origin bound to this exact Get SHA: [REQUIRED; mismatch or absence means STOP; any new deploy needs separate deployment GO]",
        "Independent source/CI, isolation/access and check-specific evidence references: [REQUIRED; flags and CI are not authority]",
        "Consenting tester / test account / device and exact scope: [REQUIRED; no personal data, tokens or credentials here]",
        "Approval time / expiry / revocation record / stop conditions: [REQUIRED; stop on mismatch, missing evidence, denied access or changed scope]",
        ["device-location", "google-oauth"].includes(id)
          ? "Separate explicit state-change GO REQUIRED for this check; existing consent/configuration and exact state-changing actions must be independently verified before execution."
          : "OAuth and device-location state changes are excluded; they require their own separate explicit GO.",
        "Excluded: club UAT/pilot GO, provider requests/credentials/availability, provisioning or configuration changes, worker activation, deploy, production, bookings/payments and outreach.",
        "Request independent review only. Do not run checks before separately documented exact-scope GO. This MVP neither sends this draft nor verifies or records GO.",
      ]);
    }).join("");
    el.candidateGoRequests.innerHTML = drafts || "<p>No missing-GO flag in this snapshot. No new per-check request is selected; existing original approvals still need independent review. No verified GO; do not execute.</p>";
  }
  // Independent candidate-wide presentation; never feeds club UAT/Operations state.
  function renderAcceptanceSummary() {
    syncGoPackages();
    if (!el.acceptanceSummary) return;
    if (state.view !== "provenance" || !state.org || (!state.demo && !state.token)) {
      el.acceptanceSummary.textContent = "";
      renderCandidateNextSteps();
      return;
    }
    if (!acceptanceAllowed()) {
      el.acceptanceSummary.textContent = "No local candidate report in this scope. Signed-in owner/admin review is required; demo has no real evidence. No verified GO.";
      renderCandidateNextSteps();
      return;
    }
    const snapshot = acceptanceSnapshot?.org === state.org && acceptanceSnapshot.auth === state.authEpoch
      ? acceptanceSnapshot : null;
    const labels = {
      not_reviewed: "No local report reviewed. Candidate checks and GO remain unverified; no counts inferred.",
      loading: "Local file read in progress. No previous snapshot or GO count retained.",
      unavailable: "Local report rejected or unavailable. No completed snapshot or verified GO.",
    };
    if (snapshot?.status !== "reviewed") {
      el.acceptanceSummary.textContent = labels[snapshot?.status] || labels.not_reviewed;
      renderCandidateNextSteps();
      return;
    }
    const observed = Date.parse(snapshot.asOf), now = Date.now();
    if (snapshot.sha !== el.acceptanceSha.value || !Number.isFinite(now) ||
        observed > now || now - observed > 24 * 60 * 60 * 1000) {
      el.acceptanceSummary.textContent = "No current local candidate snapshot: SHA changed or report expired. Review the file again; no verified GO.";
      renderCandidateNextSteps();
      return;
    }
    const blocked = snapshot.rows.filter(row => row.blocked).length;
    const missing = snapshot.rows.filter(row => row.missingGo).length;
    el.acceptanceSummary.innerHTML = `<p>GetACourt SHA: <code>${esc(snapshot.sha)}</code></p>` +
      `<p>Report time: ${esc(snapshot.asOf)}. Imported local snapshot, not live or independently attested.</p>` +
      `<p>7 checks: <strong>${blocked} blocked</strong>; ${7 - blocked} complete for manual GO review only. Executed: 0.</p>` +
      `<p><strong>GO records flagged missing / invalid: ${missing} of 7.</strong> Verified GO: none. Absence of a missing-record flag is not permission.</p>` +
      '<ul class="acceptance-summary-list">' + snapshot.rows.map((row, index) =>
        `<li>${esc(acceptanceCatalog[index][1])}: ${row.blocked ? "blocked" : "manual GO review only"}; ` +
        `${row.missingGo ? "GO record missing / invalid" : "GO not verified"}. NOT_RUN.</li>`).join("") + "</ul>" +
      "<p>Counts describe this candidate report only, not club readiness. Club UAT/pilot GO, provider rights and deployment authority stay separate.</p>";
    renderCandidateNextSteps(snapshot, "reviewed");
  }
  function setAcceptanceSnapshot(status, details = {}) {
    acceptanceSnapshot = {...details, status, org: state.org, auth: state.authEpoch};
    renderAcceptanceSummary();
  }
  function resetAcceptance(clearInputs = false) {
    acceptanceEpoch++;
    acceptanceSnapshot = null;
    if (el.acceptanceReport) el.acceptanceReport.textContent = "";
    if (el.acceptanceMessage) el.acceptanceMessage.textContent = "";
    if (clearInputs) {
      if (el.acceptanceSha) el.acceptanceSha.value = "";
      if (el.acceptanceFile) el.acceptanceFile.value = "";
    }
    if (el.acceptanceReview) el.acceptanceReview.disabled = !acceptanceAllowed();
    renderAcceptanceSummary();
  }
  function validAcceptanceReport(data, expected, now = Date.now()) {
    const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    const list = (value, expected) => Array.isArray(value) && value.length === expected.length &&
      value.every((item, index) => item === expected[index]);
    if (!exact(data, ["schemaVersion", "mode", "reviewedSha", "asOf", "executionEnabled", "authorityVerified", "releaseReady", "workerActivation", "checks"]) ||
        data.schemaVersion !== 1 || data.mode !== "READ_ONLY_OFFLINE_PREFLIGHT" ||
        !/^[a-f0-9]{40}$/.test(expected) || data.reviewedSha !== expected ||
        data.executionEnabled !== false || data.authorityVerified !== false || data.releaseReady !== false ||
        data.workerActivation !== "NOT_AUTHORISED" || typeof data.asOf !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(data.asOf)) return false;
    const observed = Date.parse(data.asOf);
    if (!Number.isFinite(observed) || new Date(observed).toISOString().replace(".000Z", "Z") !== data.asOf ||
        observed > now || now - observed > 24 * 60 * 60 * 1000 ||
        !Array.isArray(data.checks) || data.checks.length !== acceptanceCatalog.length) return false;
    return acceptanceCatalog.every(([id, , kinds, actions], index) => {
      const item = data.checks[index];
      return exact(item, ["id", "preflight", "execution", "executionEnabled", "requiresStateChangeGO", "requiredEvidence", "requiredGoActions", "blockers"]) &&
        item.id === id && item.execution === "NOT_RUN" && item.executionEnabled === false &&
        item.requiresStateChangeGO === ["device-location", "google-oauth"].includes(id) &&
        list(item.requiredEvidence, kinds) && list(item.requiredGoActions, actions) &&
        Array.isArray(item.blockers) && item.blockers.length <= 20 && new Set(item.blockers).size === item.blockers.length &&
        item.blockers.every(reason => typeof reason === "string" &&
          (Object.hasOwn(acceptanceReasons, reason) || kinds.some(kind => reason === "EVIDENCE_REQUIRED:" + kind))) &&
        item.preflight === (item.blockers.length ? "BLOCKED" : "READY_FOR_MANUAL_GO_REVIEW");
    });
  }
  async function reviewAcceptanceFile() {
    resetAcceptance();
    if (!acceptanceAllowed()) {
      el.acceptanceMessage.textContent = "Local report review requires a signed-in owner or admin scope. Demo has no real acceptance report. No file was read or sent.";
      return;
    }
    const expected = el.acceptanceSha.value, files = el.acceptanceFile.files;
    if (!/^[a-f0-9]{40}$/.test(expected) || files?.length !== 1 ||
        !Number.isInteger(files[0].size) || files[0].size < 1 || files[0].size > 65536) {
      el.acceptanceMessage.textContent = "Choose one nonsecret report JSON (maximum 64 KiB) and enter the exact GetACourt SHA. Nothing is inferred or uploaded.";
      return;
    }
    const file = files[0], epoch = acceptanceEpoch, auth = state.authEpoch, org = state.org;
    const current = () => epoch === acceptanceEpoch && auth === state.authEpoch && org === state.org &&
      acceptanceAllowed() && el.acceptanceSha.value === expected && el.acceptanceFile.files?.[0] === file;
    el.acceptanceReview.disabled = true;
    el.acceptanceMessage.textContent = "Reading local report only…";
    setAcceptanceSnapshot("loading");
    try {
      const text = await file.text();
      if (!current()) return;
      if (typeof text !== "string" || text.length > 65536) throw Error("INVALID_LOCAL_REPORT");
      const data = JSON.parse(text);
      if (!validAcceptanceReport(data, expected)) throw Error("INVALID_LOCAL_REPORT");
      const club = state.orgs.find(item => item.id === org);
      el.acceptanceReport.innerHTML = `<p>Reviewed locally in selected-club scope: <strong>${esc(club?.name)}</strong>.</p>` +
        "<p>GetACourt candidate-wide snapshot — not a club-specific report or club GO. Source and authority are not independently verified.</p>" +
        `<p>GetACourt SHA: <code>${esc(data.reviewedSha)}</code><br>Report time: ${esc(data.asOf)}. Not live; all evidence and GO must be revalidated.</p>` +
        '<ul class="acceptance-checks">' + data.checks.map((item, index) => {
          const [, label, kinds, actions] = acceptanceCatalog[index];
          const missing = item.blockers.includes("EXACT_SCOPED_GO_REQUIRED");
          return `<li><h3>${esc(label)}</h3><p><strong>${item.preflight === "BLOCKED" ? "Blocked" : "Ready for manual GO review only"}</strong> · NOT_RUN · execution disabled</p>` +
            `<p>${missing ? "Missing / invalid exact scoped GO in this snapshot." : "No verified GO. Record completeness is not authority or permission."}</p>` +
            (item.requiresStateChangeGO ? "<p>Separate state-change GO required; this action is not read-only.</p>" : "") +
            "<ul>" + item.blockers.map(reason => `<li>${esc(acceptanceReasons[reason] || "Evidence required: " + reason.slice(18))}</li>`).join("") + "</ul>" +
            `<p>Required evidence: ${esc(kinds.join(", "))}.</p><p>Exact GO action scope: ${esc(actions.join(", "))}.</p></li>`;
        }).join("") + "</ul>";
      el.acceptanceMessage.textContent = "Local snapshot reviewed. No verified GO, hosted acceptance or pilot approval. No file was uploaded and no check was run.";
      setAcceptanceSnapshot("reviewed", {sha: data.reviewedSha, asOf: data.asOf,
        rows: data.checks.map(item => ({blocked: item.preflight === "BLOCKED",
          missingGo: item.blockers.includes("EXACT_SCOPED_GO_REQUIRED")}))});
    } catch {
      if (current()) {
        setAcceptanceSnapshot("unavailable");
        el.acceptanceMessage.textContent = "Report unavailable, incompatible, stale or for another SHA. No readiness is inferred. Do not include credentials or raw evidence.";
      }
    } finally { if (current()) el.acceptanceReview.disabled = false; }
  }
  el.acceptanceForm?.addEventListener("submit", event => {
    event.preventDefault();
    if (!el.acceptanceReview.disabled) return reviewAcceptanceFile();
  });
  el.acceptanceSha?.addEventListener("input", () => resetAcceptance());
  el.acceptanceFile?.addEventListener("change", () => resetAcceptance());

  const preflightChecks = {
    operations_service: "Operations service",
    non_production_runtime: "Non-production runtime",
    runtime_revision_matches: "Runtime revision matches the expected SHA",
    provider_reads_disabled_in_this_api: "Provider reads disabled in this API only",
    owner_admin_scope: "Owner or admin scope",
    authenticated_rls_context: "Authenticated row-level security context",
    repeatable_read_only: "Repeatable read-only transaction",
    schema_rls_select: "Reader tables have row-level security and SELECT access",
    reader_columns_present: "Reader columns present",
    get_routes_present: "Read-only routes present",
  };
  const preflightNotAssessed = {
    external_runtime_identity: "Independent runtime identity",
    protected_host: "Protected-host access",
    two_org_hosted_uat: "Two-organisation hosted UAT",
    worker_provider_read_state: "Separate worker provider-read state",
    fixture_provisioning: "Fixture provisioning",
    owner_uat_go: "Owner UAT GO",
  };
  const preflightFlags = ["hosted_uat_ready", "uat_accepted", "pilot_ready",
    "provider_requests_allowed", "can_display_available_slots", "deploy_allowed"];

  function resetPreflight(clearExpected = false) {
    state.preflightEpoch++;
    if (el.preflightReport) el.preflightReport.textContent = "";
    if (el.preflightMessage) el.preflightMessage.textContent = "";
    if (el.preflightCheck) el.preflightCheck.disabled = false;
    if (clearExpected && el.operationsSha) el.operationsSha.value = "";
    setReviewSummary("preflight", state.demo ? "demo" : "not_requested");
  }

  function validPreflight(data, expected) {
    const sameKeys = (value, keys) => value && typeof value === "object" &&
      !Array.isArray(value) && Object.keys(value).length === keys.length &&
      keys.every(key => Object.hasOwn(value, key));
    const keys = ["mode", "contract_version", "as_of", "operations_runtime_sha",
      "runtime_identity_source", "status", "checks", "not_assessed", ...preflightFlags];
    if (!sameKeys(data, keys) || data.mode !== "read_only_operations_preflight" ||
        data.contract_version !== "provider-provenance-operations-preflight/v1" ||
        data.runtime_identity_source !== "railway_build_environment_not_independent_attestation" ||
        !preflightFlags.every(flag => data[flag] === false) ||
        typeof data.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(data.as_of) ||
        !Number.isFinite(Date.parse(data.as_of)) ||
        !(data.operations_runtime_sha === null ||
          (typeof data.operations_runtime_sha === "string" && operationsSHA.test(data.operations_runtime_sha))) ||
        !sameKeys(data.checks, Object.keys(preflightChecks)) ||
        !Object.values(data.checks).every(value => ["pass", "blocked"].includes(value)) ||
        !Array.isArray(data.not_assessed) || data.not_assessed.length !== Object.keys(preflightNotAssessed).length ||
        new Set(data.not_assessed).size !== data.not_assessed.length ||
        !data.not_assessed.every(key => Object.hasOwn(preflightNotAssessed, key))) return false;
    const allPass = Object.values(data.checks).every(value => value === "pass");
    return data.status === (allPass ? "operations_checks_passed" : "blocked") &&
      (data.checks.runtime_revision_matches === "pass") === (data.operations_runtime_sha === expected);
  }

  async function loadPreflight() {
    if (!state.org || state.view !== "provenance") return;
    resetPreflight();
    if (state.demo) {
      setReviewSummary("preflight", "demo");
      el.preflightMessage.textContent = "This synthetic demo has no Operations preflight. No API request was sent.";
      return;
    }
    const expected = el.operationsSha.value;
    if (!operationsSHA.test(expected)) {
      el.preflightMessage.textContent = "Enter the exact 40-character lowercase Operations SHA. No revision is inferred.";
      return;
    }
    const epoch = state.preflightEpoch, auth = state.authEpoch, org = state.org;
    const current = () => epoch === state.preflightEpoch && auth === state.authEpoch &&
      org === state.org && state.view === "provenance" && el.operationsSha.value === expected;
    el.preflightCheck.disabled = true;
    el.preflightMessage.textContent = "Checking scoped Operations prerequisites…";
    setReviewSummary("preflight", "loading");
    try {
      const data = await api(`/api/fmc/${encodeURIComponent(org)}/provider-provenance/preflight?expected_operations_sha=${expected}`,
        null, null, epoch);
      if (!current()) return;
      if (!validPreflight(data, expected)) throw Error("INVALID_PREFLIGHT");
      setReviewSummary("preflight", data.status === "operations_checks_passed" ? "passed" : "blocked",
        {asOf: data.as_of, expected, runtime: data.operations_runtime_sha,
          blocked: Object.values(data.checks).filter(value => value === "blocked").length,
          blockedChecks: Object.keys(preflightChecks).filter(key => data.checks[key] === "blocked")});
      el.preflightMessage.textContent = data.status === "operations_checks_passed"
        ? "Operations checks passed — not UAT or pilot approval."
        : "Operations checks blocked — UAT and pilot remain unapproved.";
      el.preflightReport.innerHTML = `<p>Snapshot: ${esc(data.as_of)}. Re-check after any scope or runtime change.</p>` +
        `<p>Expected Operations SHA: <code>${esc(expected)}</code></p>` +
        `<p>Reported runtime SHA: <code>${esc(data.operations_runtime_sha || "Not reported")}</code></p>` +
        "<p>Runtime revision is self-reported build metadata, not independent identity attestation.</p>" +
        '<ul class="preflight-checks">' + Object.entries(preflightChecks).map(([key, label]) =>
          `<li>${esc(label)}: <strong>${data.checks[key] === "pass" ? "Pass" : "Blocked"}</strong></li>`).join("") + "</ul>" +
        "<h3>Not assessed</h3><ul>" + Object.values(preflightNotAssessed).map(label => `<li>${esc(label)}</li>`).join("") + "</ul>";
    } catch (error) {
      if (current() && state.token && !["STALE_SESSION", "STALE_REQUEST"].includes(error?.message)) {
        setReviewSummary("preflight", error?.status === 403 ? "denied" : "unavailable");
        el.preflightMessage.textContent = error?.status === 403
          ? "You do not have permission to check Operations preflight for this organisation."
          : "Operations preflight unavailable or incompatible. No readiness is inferred; UAT and pilot remain unapproved.";
      }
    } finally { if (current()) el.preflightCheck.disabled = false; }
  }

  el.preflightForm?.addEventListener("submit", event => {
    event.preventDefault();
    if (!el.preflightCheck.disabled) return loadPreflight();
  });
  el.operationsSha?.addEventListener("input", () => resetPreflight());

  // Local sanitized manifest completeness ONLY. No document fetch, signature or
  // authority verification, approval storage, message, execution or shared GO.
  const goPackageCommon = ["original-authority", "source-binding", "protected-deploy",
    "independent-runtime", "isolation", "tester-consent", "scope-allowlist",
    "current-evidence", "unresolved-blockers", "expiry-revocation-stop"];
  const clubPackageActions = ["operations-preflight-get", "stored-provenance-get",
    "two-synthetic-org-isolation", "unauthenticated-access-denial", "wrong-role-access-denial", "cross-org-access-denial"];
  const goPackageUI = Object.fromEntries(["club", "get"].map(domain => [domain, {
    form: q("#" + domain + "PackageForm"), file: q("#" + domain + "PackageFile"),
    button: q("#" + domain + "PackageReview"), result: q("#" + domain + "PackageResult"),
  }]));
  const goPackageCheck = q("#getPackageCheck");
  const goPackageState = {club: {epoch: 0, key: null}, get: {epoch: 0, key: null}};
  function packageTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return NaN;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString().replace(".000Z", "Z") === value ? time : NaN;
  }
  function packageFresh(value, now = Date.now(), validatedSourceTimestamp = false) {
    const time = validatedSourceTimestamp ? Date.parse(value) : packageTime(value);
    return Number.isFinite(now) && time <= now && now - time <= 86400000;
  }
  function packageCandidate() {
    const s = acceptanceSnapshot;
    return acceptanceAllowed() && s?.status === "reviewed" && s.org === state.org && s.auth === state.authEpoch &&
      s.sha === el.acceptanceSha.value && packageFresh(s.asOf) ? s : null;
  }
  function packageContext(domain) {
    if (!acceptanceAllowed()) return null; // Same owner/admin view gate, not candidate evidence.
    if (domain === "club") {
      const s = state.reviewSummary.preflight;
      if (!s || s.org !== state.org || s.auth !== state.authEpoch ||
          !["passed", "blocked"].includes(s.status) || !operationsSHA.test(s.expected) ||
          s.expected !== el.operationsSha.value || !packageFresh(s.asOf, Date.now(), true)) return null;
      return {sha: s.expected, check: "club-provenance-uat", observed: s.asOf,
        actions: clubPackageActions, required: [...goPackageCommon, "two-synthetic-orgs", "connection-freshness", "club-wide-coverage"]};
    }
    const s = packageCandidate(), check = acceptanceCatalog.find(row => row[0] === goPackageCheck?.value);
    return s && check ? {sha: s.sha, check: check[0], observed: s.asOf, actions: check[3],
      required: [...new Set([...goPackageCommon, ...check[2],
        ...(["device-location", "google-oauth"].includes(check[0]) ? ["separate-state-change-go"] : [])])]} : null;
  }
  function clearGoPackage(domain, key = null, clearFile = true) {
    const previous = goPackageState[domain];
    goPackageState[domain] = {epoch: previous.epoch + 1, key};
    if (clearFile && goPackageUI[domain].file) goPackageUI[domain].file.value = "";
    if (goPackageUI[domain].result) goPackageUI[domain].result.textContent = "";
  }
  function syncGoPackages() {
    if (goPackageCheck) {
      goPackageCheck.disabled = !packageCandidate();
      if (goPackageCheck.disabled) goPackageCheck.value = "";
    }
    for (const domain of ["club", "get"]) {
      const ctx = packageContext(domain), ui = goPackageUI[domain], previous = goPackageState[domain];
      const key = ctx ? [state.org, state.authEpoch, ctx.sha, ctx.check, ctx.observed].join("|") : null;
      if (key !== previous.key || (!key && (previous.result || previous.loading || ui.file?.files?.length))) clearGoPackage(domain, key);
      const current = goPackageState[domain];
      if (current.result && (!packageFresh(current.result.asOf) || current.result.until <= Date.now())) {
        clearGoPackage(domain, key);
        if (ui.result) ui.result.textContent = "Manifest review window expired. Review a current manifest again. No verified GO.";
      }
      if (ui.button) ui.button.disabled = !ctx || Boolean(goPackageState[domain].loading);
    }
  }
  function inspectGoPackage(data, domain, ctx) {
    const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    const keys = ["schemaVersion", "mode", "domain", "sourceSha", "checkId", "asOf", "reviewUntil",
      "authorityVerified", "executionEnabled", "actions", "items", ...(domain === "club" ? ["organisationId"] : [])];
    if (!exact(data, keys) || data.schemaVersion !== 1 || data.mode !== "READ_ONLY_GO_PACKAGE" ||
        data.domain !== domain || data.sourceSha !== ctx.sha || data.checkId !== ctx.check ||
        (domain === "club" && data.organisationId !== state.org) || data.authorityVerified !== false ||
        data.executionEnabled !== false || !packageFresh(data.asOf) ||
        !(packageTime(data.reviewUntil) > Date.now()) || packageTime(data.reviewUntil) > packageTime(data.asOf) + 86400000 ||
        !Array.isArray(data.actions) || data.actions.length !== ctx.actions.length ||
        !data.actions.every((action, i) => action === ctx.actions[i]) || !Array.isArray(data.items) ||
        data.items.length > ctx.required.length || new Set(data.items.map(item => item?.id)).size !== data.items.length ||
        !data.items.every(item => exact(item, ["id", "state"]) && ctx.required.includes(item.id) &&
          ["PRESENT", "MISSING", "UNKNOWN"].includes(item.state))) throw Error("INVALID_MANIFEST");
    return {asOf: data.asOf, until: packageTime(data.reviewUntil),
      rows: ctx.required.map(id => ({id, status: data.items.find(item => item.id === id)?.state || "MISSING"}))};
  }
  async function reviewGoPackage(domain) {
    syncGoPackages();
    const ctx = packageContext(domain), ui = goPackageUI[domain], key = goPackageState[domain].key;
    clearGoPackage(domain, key, false);
    if (!ctx) {
      if (ui.result) ui.result.textContent = "No current owner/admin source context. Club needs an explicit completed Operations read; Get needs a fresh reviewed report and selected check. No file read; no GO.";
      return;
    }
    const files = ui.file?.files;
    if (files?.length !== 1 || !Number.isInteger(files[0].size) || files[0].size < 1 || files[0].size > 32768) {
      ui.result.textContent = "Select one sanitized manifest JSON, at most 32 KiB. Never supply raw approvals, documents, URLs, personal data or credentials. Nothing is uploaded.";
      return;
    }
    const file = files[0], epoch = goPackageState[domain].epoch;
    const current = () => {
      syncGoPackages();
      return goPackageState[domain].epoch === epoch && goPackageState[domain].key === key && ui.file.files?.[0] === file;
    };
    goPackageState[domain].loading = true;ui.button.disabled = true;
    ui.result.textContent = "Reading sanitized local manifest only. No previous completeness result retained.";
    try {
      const text = await file.text();
      if (!current()) return;
      if (typeof text !== "string" || text.length > 32768) throw Error("INVALID_MANIFEST");
      const result = inspectGoPackage(JSON.parse(text), domain, ctx);
      goPackageState[domain].result = result;
      const present = result.rows.filter(row => row.status === "PRESENT").length;
      ui.result.innerHTML = `<p>${domain === "club" ? "Club protected UAT" : "GetACourt " + esc(ctx.check)} · SHA <code>${esc(ctx.sha)}</code></p>` +
        (domain === "club" ? `<p>Organisation: <code>${esc(state.org)}</code></p>` : "") +
        `<p>Manifest time: ${esc(result.asOf)}; local review window ends ${esc(new Date(result.until).toISOString())}. Not verified approval validity.</p>` +
        `<p><strong>${present === result.rows.length ? "All required items declared present — independent manual review required" : "Manifest incomplete — missing or unknown items remain"}.</strong></p>` +
        `<p>${present} of ${result.rows.length} items declared present. Presence declarations only, NOT document or authority validation. Verified GO: none. Execution NOT_RUN.</p>` +
        '<ul class="go-package-items">' + result.rows.map(row => `<li>${esc(row.id)}: ${esc(row.status)}</li>`).join("") + '</ul>' +
        "<p>Existing blockers stay open. Club UAT, pilot, Get checks, provider rights and deployment permissions are not interchangeable. No sending, approval, execution or repair.</p>";
    } catch {
      if (current()) ui.result.textContent = "Manifest rejected: incompatible, unsafe, expired or foreign scope. No completeness result or verified GO. Nothing sent.";
    } finally {
      if (current()) {goPackageState[domain].loading = false;syncGoPackages();}
    }
  }
  for (const domain of ["club", "get"]) {
    const ui = goPackageUI[domain];
    ui.form?.addEventListener("submit", event => {
      event.preventDefault();
      if (!goPackageState[domain].loading) return reviewGoPackage(domain);
    });
    ui.file?.addEventListener("change", () => {clearGoPackage(domain, goPackageState[domain].key, false);syncGoPackages();});
  }
  goPackageCheck?.addEventListener("change", () => {clearGoPackage("get");syncGoPackages();});

  async function load() {
    resetProvenance(true);
    if (!state.org) return;
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
    renderReviewSummary();
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
