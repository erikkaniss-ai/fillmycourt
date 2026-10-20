const stateLabel = {
  actual_verified: "actual verified",
  synthetic_verified: "synthetic verified",
  manual: "manual",
  unverified: "unverified"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Lisbon"
  }).format(new Date(value));
}

function badge(state) {
  const label = stateLabel[state] || "unverified";
  return `<span class="badge ${state || "unverified"}">${label}</span>`;
}

function list(target, values) {
  target.innerHTML = (values || []).map((value) => `<li>${value}</li>`).join("") || "<li>None recorded.</li>";
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
  const ci = github.ci;
  const ciText = escapeHtml(ci?.runId ? `${ci.name}: ${ci.conclusion || ci.status} (#${ci.runId})` : ci?.name);
  const pr = github.pullRequest;
  target.innerHTML = `
    <div class="live-source-top">${badge("actual_verified")} <strong>GitHub live refresh</strong><span>${formatTime(github.fetchedAt)}</span></div>
    <p><a href="${escapeHtml(pr.url)}" target="_blank" rel="noreferrer">PR #${Number(pr.number)}</a> · ${pr.draft ? "draft" : escapeHtml(pr.state)} · <code>${escapeHtml(pr.sha.slice(0, 12))}</code></p>
    <p>${ci?.url ? `<a href="${ci.url}" target="_blank" rel="noreferrer">${ciText}</a>` : ciText || "CI unknown"} · commit status: ${github.commitStatus}</p>`;
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
  if (progress === null) {
    label.textContent = "No verified baseline";
    root.querySelector(".progress-note").textContent = "Progress is intentionally withheld until weighted acceptance criteria are defined and reviewed.";
    root.querySelector(".progress-track").classList.add("unknown-track");
  } else {
    label.textContent = `${progress}%`;
    root.querySelector(".progress-value").style.width = `${progress}%`;
    root.querySelector(".progress-note").textContent = "Weighted engineering acceptance only. It is not a release, provider-authority or production-readiness percentage.";
  }

  renderGithub(root.querySelector(".live-source"), project.githubLive);
  const milestoneList = root.querySelector(".milestones");
  milestoneList.innerHTML = (project.milestones || []).map((milestone) => `
    <li>
      <div class="milestone-heading"><strong>${milestone.name}</strong><span>${milestone.weight}% · ${milestone.acceptance}</span></div>
      ${badge(milestone.evidence)}<p>${milestone.reference}</p>
    </li>`).join("") || "<li>No milestone baseline has been supplied.</li>";

  list(root.querySelector(".now"), project.now);
  list(root.querySelector(".next"), project.next);
  list(root.querySelector(".blocked"), project.blocked);
  root.querySelector(".environments").innerHTML = (project.environments || []).map((environment) => `
    <p class="environment">${badge(environment.state)} <strong>${environment.name}</strong> — ${environment.url ? `<a href="${environment.url}" target="_blank" rel="noreferrer">${environment.value}</a>` : environment.value}<br><span>Last read: ${formatTime(environment.lastVerifiedAt)}</span></p>`).join("") || "<p>No environment has been verified for this project in the current dashboard input.</p>";
  root.querySelector(".history").innerHTML = (project.history || []).map((entry) => `<li>${badge(entry.state)} <strong>${formatTime(entry.at)}</strong> — ${entry.change}</li>`).join("") || "<li>No verified change history is available yet.</li>";
  return fragment;
}

function render(snapshot) {
  const { rollup } = snapshot;
  document.querySelector("#freshness").innerHTML = `${badge("actual_verified")} GitHub refresh: ${formatTime(snapshot.fetchedAt)}`;
  document.querySelector("#rollup").innerHTML = `
    <div class="rollup-number">${rollup.percent === null ? "—" : `${rollup.percent}%`}</div>
    <div><strong>Proposed milestone model · owner review pending</strong><p>${rollup.baselinedProjects} of ${rollup.totalProjects} projects have a draft model. ${rollup.completedWeight} of ${rollup.totalWeight} weighted points map to recorded evidence. Weights are engineering proposals and are not owner-approved project completion metrics.</p></div>`;
  const projects = document.querySelector("#projects");
  projects.replaceChildren(...snapshot.projects.map(renderProject));
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
