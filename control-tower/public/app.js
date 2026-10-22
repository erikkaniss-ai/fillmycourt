const stateLabel = {
  actual_verified: "actual verified",
  synthetic_verified: "synthetic verified",
  manual: "manual",
  unverified: "UNKNOWN"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function formatTime(value) {
  if (!Number.isFinite(Date.parse(value))) return 'UNKNOWN';
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Lisbon"
  }).format(new Date(value));
}

function badge(state) {
  const safeState = Object.hasOwn(stateLabel, state) ? state : "unverified";
  return `<span class="badge ${safeState}">${stateLabel[safeState]}</span>`;
}

function list(target, values) {
  target.innerHTML = (values || []).map((value) => `<li>${escapeHtml(value)}</li>`).join("") || "<li>None recorded.</li>";
}

function safeLink(url, label) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
    return `<a href="${escapeHtml(parsed.href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
  } catch { return escapeHtml(label); }
}

function renderGithub(target, github) {
  if (!github) {
    target.innerHTML = `${badge("unverified")} <span>GitHub source is not configured.</span>`;
    return;
  }
  if (github.state !== "actual_verified") {
    target.innerHTML = `${badge("unverified")} <span>GitHub refresh unavailable: ${escapeHtml(github.error || "unknown reason")}.</span>`;
    return;
  }
  if (github.pullRequests) {
    target.innerHTML = `${badge("actual_verified")} GitHub listing · ${formatTime(github.fetchedAt)}<p>${github.openPullsReturned}${github.listingMayBeTruncated ? "+" : ""} open PRs returned. ${escapeHtml(github.coverage)}.</p>`;
    for (const pull of github.pullRequests) {
      const item = document.createElement("section");
      renderGithub(item, pull);
      if (pull.blockerLabels?.length) {
        const labels = document.createElement("p");
        labels.textContent = `GitHub blocker labels: ${pull.blockerLabels.join(", ")}. Owner / GO details: UNKNOWN unless recorded in the decision source.`;
        item.append(labels);
      }
      target.append(item);
    }
    return;
  }
  const coverage = github.sourceCoverage || {pr:true,actions:false,commitStatus:false};
  const incomplete = [];
  if (coverage.actions === false) incomplete.push("Actions unavailable — CI UNKNOWN");
  if (coverage.commitStatus === false) incomplete.push("Commit statuses unavailable");
  const evidenceWarning = incomplete.length ?
    `<p><strong>Partial source evidence:</strong> ${escapeHtml(incomplete.join("; "))}. PR head independently verified.</p>` : "";
  const required = github.requiredCi || { verdict: "unverified", checks: [] };
  const names = {success:"PASS",running:"RUNNING",failed_or_other:"FAIL/BLOCKED",unverified:"UNKNOWN"};
  const requiredState = Object.hasOwn(names,required.verdict) ? required.verdict : "unverified";
  const requiredBadge = requiredState === "success" ? badge("actual_verified") : badge("unverified");
  const requiredRows = (required.checks||[]).map(check =>
    "<li>"+escapeHtml(check.workflow)+": <strong>"+
    escapeHtml(names[check.status]||"UNKNOWN")+"</strong>"+
    (check.url ? " · "+safeLink(check.url,"CI evidence") : "")+
    (check.reason ? " — "+escapeHtml(check.reason) : "")+"</li>").join("") ||
    "<li>Required workflow baseline not configured. CI readiness: UNKNOWN.</li>";
  const activity = (github.sourceActivity || []).map(event =>
    "<li>"+safeLink(event.url,event.label)+" · "+
    escapeHtml(formatTime(event.at))+"</li>").join("");
  const activityPanel = activity
    ? "<details><summary>Recent GitHub activity (source timestamps, not acceptance)</summary><ul>"+activity+"</ul></details>"
    : "<p>Recent GitHub activity: UNKNOWN (no verifiable timestamps).</p>";
  const ci = github.ci;
  const ciText = escapeHtml(ci?.runId ? `${ci.name}: ${ci.conclusion || ci.status} (#${ci.runId})` : ci?.name);
  const pr = github.pullRequest;
  target.innerHTML = `
    <div class="live-source-top">${badge("actual_verified")} <strong>GitHub live refresh</strong><span>${formatTime(github.fetchedAt)}</span></div>
    <p>${safeLink(pr.url, `PR #${pr.number}`)} · ${pr.draft ? "draft" : escapeHtml(pr.state)} · <code>${escapeHtml(pr.sha.slice(0, 12))}</code></p>
    <p>${escapeHtml(pr.title)}</p>
    ${evidenceWarning}
    <p>${requiredBadge} <strong>Required CI: ${escapeHtml(names[requiredState])}</strong></p>
    <ul>${requiredRows}</ul>
    <p>Other workflow observation: ${ci?.url ? safeLink(ci.url, `${ci.name}: ${ci.conclusion || ci.status} (#${ci.runId})`) : ciText || "UNKNOWN"} · commit status: ${escapeHtml(github.commitStatus)}</p>
    <ul>${(github.workflows || []).map((run) => `<li>${safeLink(run.url, `${run.name}: ${run.conclusion || run.status}`)} · exact HEAD</li>`).join("") || "<li>Exact-head workflow evidence: UNKNOWN</li>"}</ul>
    ${activityPanel}`;
}

function renderProject(project) {
  const template = document.querySelector("#project-template");
  const fragment = template.content.cloneNode(true);
  const root = fragment.querySelector(".project-card");
  root.querySelector(".portfolio").textContent = project.portfolio;
  root.querySelector("h3").textContent = project.name;
  root.querySelector(".access").textContent = project.access.replaceAll("-", " ");

  const progress = project.progress;
  const label = root.querySelector(".progress-label");
  const breakdown = project.progressBreakdown;
  if (breakdown?.approved) {
    label.innerHTML = `<span class="mvp-kpi"><b>${Number(breakdown.confirmed)}%</b><small>принято MVP</small></span><span class="mvp-kpi remaining"><b>${100-Number(breakdown.confirmed)}%</b><small>до полной приёмки</small></span>`;
    root.querySelector('.mvp-uncertainty').textContent = `Не проверено: ${breakdown.unknown}% (UNKNOWN)${breakdown.unfinished ? ' · Известно не завершено: '+breakdown.unfinished+'%' : ''}.`;
    root.querySelector('.mvp-brief').textContent = project.evidenceReview?.brief ||
      (breakdown.confirmed===100 ? 'Все критерии этого MVP приняты. Production — отдельное решение.' : 'Приёмка MVP ещё не завершена. Непроверенное не считается готовым.');
    root.querySelector('.progress-value').style.width = `${breakdown.confirmed}%`;
    root.querySelector('.progress-note').textContent = `Approved ${project.approval.id}. Known unfinished: ${breakdown.unfinished}%. Overall readiness: ${breakdown.overall === null ? 'UNKNOWN' : breakdown.overall + '%'}. Confirmed source/synthetic acceptance is not hosted/live readiness or release GO. ${project.kind === 'product' ? 'Product rollup weight: ' + project.portfolioWeight + '%.' : 'Dependency/enabler: excluded from product rollup.'}`;
  } else if (progress === null) {
    label.textContent = "UNKNOWN";
    root.querySelector('.mvp-uncertainty').textContent = 'Объём MVP не утверждён: процент и остаток неизвестны.';
    root.querySelector(".progress-note").textContent = "Progress is intentionally withheld until weighted acceptance criteria are defined and reviewed.";
    root.querySelector(".progress-track").classList.add("unknown-track");
  } else {
    label.textContent = `${progress}%`;
    root.querySelector(".progress-value").style.width = `${progress}%`;
    root.querySelector(".progress-note").textContent = "Weighted engineering acceptance only. It is not a release, provider-authority or production-readiness percentage.";
  }

  if (project.evidenceReview) root.querySelector('.progress-note').textContent +=
    ' Decision evidence reviewed: ' + formatTime(project.evidenceReview.reviewedAt) + '. Scope: ' + (project.evidenceReview.scope || 'manual review') + '.';
  if(project.delivery){
    const delivery=project.delivery;
    root.querySelector('.pilot-summary').hidden=false;
    root.querySelector('.pilot-status').textContent='Рабочий запуск пилота: '+(delivery.launchStatus==='BLOCKED'?'НЕ ГОТОВ · BLOCKED':'UNKNOWN');
    root.querySelector('.pilot-goal').textContent=delivery.pilotGoal||project.target||'Состав пилота не подтверждён.';
    root.querySelector('.pilot-blockers').innerHTML=delivery.blockers.map(row=>'<li>'+escapeHtml(row.name)+(row.owner?' — '+escapeHtml(row.owner):'')+(row.go?' · GO: '+escapeHtml(row.go):'')+'</li>').join('');
    root.querySelector('.pilot-next').textContent=delivery.nextGate?'Далее: '+delivery.nextGate:'';
  }
  renderGithub(root.querySelector(".live-source"), project.githubLive);
  const tracked = project.githubLive?.state === 'actual_verified'
    ? (project.githubLive.pullRequests || [project.githubLive]) : [];
  const sourceCounts = tracked.reduce((counts, pull) => {
    const verdict = pull.requiredCi?.verdict || 'unverified';
    counts[verdict] = (counts[verdict] || 0) + 1;
    return counts;
  }, {});
  root.querySelector('.source-summary').textContent = tracked.length
    ? 'PR / CI evidence · ' + tracked.length + ' tracked · ' + (sourceCounts.success || 0) + ' PASS · ' +
      (sourceCounts.unverified || 0) + ' UNKNOWN · ' + (sourceCounts.failed_or_other || 0) + ' FAIL · ' + (sourceCounts.running || 0) + ' RUNNING'
    : 'PR / CI evidence · UNKNOWN (unavailable or not configured)';
  const milestoneList = root.querySelector(".milestones");
  milestoneList.innerHTML = (project.milestones || []).map((milestone) => `
    <li>
      <div class="milestone-heading"><strong>${escapeHtml(milestone.id || '')} ${escapeHtml(milestone.name)}</strong><span>${Number(milestone.weight)}% ${project.baseline ? 'approved' : 'draft'} weight · ${escapeHtml(milestone.acceptance)}</span></div>
      ${badge(milestone.evidence)}<p>${escapeHtml(milestone.reference)}</p>
      ${(milestone.acceptanceCriteria || []).map(c => `<p>Acceptance: ${escapeHtml(c)}</p>`).join('')}
      ${milestone.blockerOwner ? `<p>Owner: ${escapeHtml(milestone.blockerOwner)}. Erik GO: ${escapeHtml(milestone.erikGo)}</p>` : ''}
      ${milestone.receipt ? `<p>Reviewed: ${escapeHtml(milestone.receipt.reviewer)} · ${escapeHtml(formatTime(milestone.receipt.verifiedAt))}</p>` : ''}
      ${(milestone.receipt?.evidenceUrls || []).map(url => `<p>${safeLink(url, 'Acceptance evidence')}</p>`).join('')}
    </li>`).join("") || "<li>No milestone baseline has been supplied.</li>";

  list(root.querySelector(".now"), project.now);
  list(root.querySelector(".next"), project.next);
  list(root.querySelector(".blocked"), project.blocked);
  root.querySelector(".environments").innerHTML = (project.environments || []).map((environment) => `
    <p class="environment">${badge("manual")} <strong>${escapeHtml(environment.name)}</strong> — ${environment.url ? safeLink(environment.url, environment.value) : escapeHtml(environment.value)}<br><span>Dated recorded snapshot: ${formatTime(environment.lastVerifiedAt)}. Current state: UNKNOWN; not a live deployment check.</span></p>`).join("") || "<p>Environment / hosted QA: UNKNOWN. No current verified environment input.</p>";
  root.querySelector('.environments').innerHTML += (project.evidenceReview?.links || [])
    .map(link => '<p>' + safeLink(link.url, link.title) + ' — recorded link, not hosted acceptance.</p>').join('');
  root.querySelector(".history").innerHTML = (project.history || []).map((entry) => `<li>${badge(entry.state)} <strong>${formatTime(entry.at)}</strong> — ${escapeHtml(entry.change)}</li>`).join("") || "<li>Persistent change history: UNKNOWN; not collected yet.</li>";
  return fragment;
}

function render(snapshot) {
  const { rollup } = snapshot;
  const rollupKnown = !!snapshot.approvedBaseline && Number.isFinite(rollup.confirmed);
  const configured = snapshot.projects.filter((project) => project.github).length;
  const verified = snapshot.projects.filter((project) => project.githubLive?.state === "actual_verified").length;
  document.querySelector("#freshness").innerHTML = `${badge(verified === configured && configured > 0 ? "actual_verified" : "unverified")} GitHub ${verified}/${configured}: ${formatTime(snapshot.fetchedAt)}`;
  document.querySelector("#rollup").innerHTML = `
    <div class="rollup-number">${rollupKnown ? Number(rollup.confirmed)+'%' : 'UNKNOWN'}<small>принято MVP</small></div>
    <div><strong>Портфель: ${rollupKnown ? (100-Number(rollup.confirmed))+'% до полной приёмки MVP' : 'прогресс MVP неизвестен'}</strong><p>«Осталось» — непринятая часть MVP, включая UNKNOWN, а не оценка часов или несделанного кода. Четыре продукта имеют одинаковый вес; инфраструктура в общий процент не входит. MVP не означает разрешение production.</p><p>${rollupKnown ? `Не проверено: ${rollup.unknown}% (UNKNOWN).` : 'Нет полной подтверждённой основы для процента.'}</p></div>`;
  const projects = document.querySelector("#projects");
  projects.replaceChildren(...snapshot.projects.filter(p=>!p.kind||p.kind==='product').map(renderProject));
  document.querySelector('#dependencies').replaceChildren(...snapshot.projects.filter(p=>p.kind&&p.kind!=='product').map(renderProject));
  for(const [key,sectionId,listId] of [['active','roadmap','active-directions'],['future','future-roadmap','future-services']]){
    const rows=snapshot.projects.flatMap(project=>(project.delivery?.[key]||[]).map(row=>({...row,project})));
    document.querySelector('#'+sectionId).hidden=!rows.length;
    document.querySelector('#'+listId).innerHTML=rows.map(row=>'<article class="roadmap-item"><h3>'+escapeHtml(row.name)+'</h3><span class="roadmap-status">'+(key==='active'?'Активное направление':'План / backlog')+' · % UNKNOWN</span><p>'+escapeHtml(row.scope)+'</p>'+(row.gate?'<p class="roadmap-gate">Блокер: '+escapeHtml(row.gate)+'</p>':'')+'<details><summary>Источник решения</summary>'+row.project.delivery.sourceLinks.map(link=>'<p>'+safeLink(link.url,link.title)+'</p>').join('')+'</details></article>').join('');
  }
}

async function start() {
  try {
    const response = await fetch("/api/snapshot", { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
    render(await response.json());
  } catch (error) {
    document.querySelector("#freshness").innerHTML = `${badge("unverified")} Snapshot unavailable`;
    document.querySelector("#rollup").innerHTML = `<p class="error">The read-only snapshot could not be loaded: ${escapeHtml(error.message)}</p>`;
  }
}

start();
setInterval(start, 300_000);
