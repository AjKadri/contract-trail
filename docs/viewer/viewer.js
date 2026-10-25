const traceSelect = document.querySelector("#trace-select");
const traceFile = document.querySelector("#trace-file");
const question = document.querySelector("#question");
const timeline = document.querySelector("#timeline");
const summary = document.querySelector("#summary");
const leads = document.querySelector("#leads");
const leadCount = document.querySelector("#lead-count");
const tracePath = document.querySelector("#trace-path");

const money = (value) => `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Math.round(value))}`;
const shortModel = (value) => {
  if (!value) return "unknown model";
  const normalized = value.toLowerCase();
  if (normalized.includes("ultra")) return "ULTRA 550B";
  if (normalized.includes("lightning")) return "LIGHTNING 30B";
  return value.split("/").at(-1) || value;
};
const formatDuration = (milliseconds) => milliseconds == null ? "in progress" : milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
const shortLeadId = (value) => {
  if (value === "price-gap-federal-vs-oyo") return "price-gap";
  if (typeof value === "string" && value.startsWith("twin-award-")) return "twin-award";
  return typeof value === "string" && value.length > 28 ? `${value.slice(0, 25)}…` : value || "lead";
};
const sourcesFor = (sql) => [...new Set([...String(sql || "").matchAll(/(?:FROM|JOIN)\s+([a-z0-9_]+)\./giu)].map((match) => match[1]))];
const datasource = (sql) => { const sources = sourcesFor(sql); return sources.length > 1 ? `${sources.join(" + ")} · federated` : sources[0] || "ZETARIS"; };
const evidenceUrl = (id) => `https://data.open-contracting.org/en/search/?q=${encodeURIComponent(String(id).split("/")[0])}`;

function parseJson(value) {
  if (typeof value !== "string") return null;
  const source = value.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  try { return JSON.parse(source); } catch { return null; }
}

function challengeFor(trace, leadId) {
  const entry = [...(trace.criticChallenges || [])].reverse().find((candidate) => {
    if (candidate.leadId !== leadId) return false;
    const embedded = parseJson(candidate.challenge);
    return !embedded?.leadId || embedded.leadId === leadId;
  });
  if (!entry) return "No challenge recorded for this lead.";
  const embedded = parseJson(entry.challenge);
  return embedded?.challenge || embedded?.reason || entry.challenge || "No challenge recorded for this lead.";
}

function parseGap(lead) {
  const match = String(lead.arithmetic || "").match(/Federal median\s+([\d,.]+)\s+NGN\/book\s+÷\s+Oyo median\s+([\d,.]+)\s+NGN\/book\s+=\s+([\d,.]+)×/iu);
  if (!match) return null;
  return { federal: Number(match[1].replaceAll(",", "")), oyo: Number(match[2].replaceAll(",", "")), ratio: Number(match[3].replaceAll(",", "")) };
}

function headlineFor(lead) {
  const gap = parseGap(lead);
  return gap ? `Federal exercise books cost ${gap.ratio.toFixed(1)}× what Oyo paid, matched on leaf count` : lead.title;
}

function dispositionFor(trace, leadId) {
  return (trace.dispositionChanges || []).find((change) => change.leadId === leadId);
}

function outcome(change) {
  if (!change) return "The evidence remains open for verification.";
  if (change.disposition === "withdraw") return "Withdrawn by the defence critic after review.";
  if (change.disposition === "stand") return `The defence critic let this lead stand at ${(change.after || change.before).toUpperCase()}.`;
  return `The defence critic downgraded this lead from ${change.before.toUpperCase()} to ${(change.after || "LOW").toUpperCase()}.`;
}

function evidenceMeta(trace, evidenceId) {
  const ocid = String(evidenceId).split("/")[0];
  for (const call of trace.toolCalls || []) for (const row of call.resultRows || []) {
    if (String(row[1] ?? "") === ocid) return { title: row[3], value: Number(row[5]) };
    if (String(row[0] ?? "") === ocid) return { title: row[3], value: Number(row[4]) };
  }
  return {};
}

function textBlock(label, text) {
  const section = document.createElement("section");
  section.className = "text-block";
  section.innerHTML = `<p class="eyebrow">${label}</p><p>${String(text)}</p>`;
  return section;
}

function leadCard(trace, lead) {
  const card = document.createElement("article");
  card.className = `lead-card severity-bar-${lead.severity}`;
  const change = dispositionFor(trace, lead.id);
  const gap = parseGap(lead);
  card.innerHTML = `<div class="lead-head"><span class="severity severity-${lead.severity}">${lead.severity}</span><span class="lead-kicker">LEAD TO VERIFY</span></div><h3>${headlineFor(lead)}</h3>${gap ? `<div class="price-pair"><div><span>Federal median</span><strong>${money(gap.federal)}</strong></div><span class="pair-divider">vs</span><div><span>Oyo median</span><strong>${money(gap.oyo)}</strong></div></div>` : ""}<p class="arithmetic">${lead.arithmetic || ""}</p>${change ? `<div class="disposition-line"><s>${change.before.toUpperCase()}</s><span>→</span><strong>${(change.after || "withdrawn").toUpperCase()}</strong><span>· ${change.disposition === "withdraw" ? "withdrawn" : change.disposition === "stand" ? "stood" : "downgraded"} by defence critic</span></div>` : ""}<div class="evidence-row"></div>`;
  const evidenceRow = card.querySelector(".evidence-row");
  for (const id of (lead.evidenceIds || []).slice(0, 8)) {
    const meta = evidenceMeta(trace, id);
    const chip = document.createElement("a");
    chip.className = "evidence-chip";
    chip.href = evidenceUrl(id);
    chip.target = "_blank";
    chip.rel = "noreferrer";
    chip.title = `${meta.title || id}${Number.isFinite(meta.value) ? ` · ${money(meta.value)}` : ""}`;
    chip.textContent = String(id).split("/")[0];
    evidenceRow.append(chip);
  }
  card.append(textBlock("Defence critic says", challengeFor(trace, lead.id)));
  card.append(textBlock("Answer", outcome(change)));
  card.append(textBlock("Verify on the ground", lead.whatToVerify || "Verify the source records and delivery evidence."));
  return card;
}

function closedRow(trace, item, state) {
  const row = document.createElement("details");
  row.className = "closed-row";
  const lead = (trace.finalLeads || []).find((candidate) => candidate.id === item.leadId);
  const title = lead ? headlineFor(lead) : shortLeadId(item.leadId);
  row.innerHTML = `<summary><span class="closed-title">${title}</span><span class="closed-state">${state}</span><span class="closed-reason">${item.reason}</span></summary><p>${item.reason}</p>`;
  return row;
}

function renderSummary(trace) {
  const calls = trace.toolCalls || [];
  const sources = [...new Set(calls.flatMap((call) => sourcesFor(call.sql)))];
  const counts = new Map();
  for (const call of trace.modelCalls || []) { const model = shortModel(call.returnedModel || call.requestedModel); counts.set(model, (counts.get(model) || 0) + 1); }
  const modelText = [...counts.entries()].map(([model, count]) => `${model} ×${count}`).join(" · ");
  const requests = (trace.criticRequests || []).filter((request) => request.status === "executed").length;
  summary.innerHTML = `<div class="summary-head"><p class="eyebrow">Run summary</p><span class="replayed-badge">REPLAYED</span></div><div class="summary-grid"><div><strong>${calls.length}</strong><span>Zetaris queries</span></div><div><strong>${sources.length}</strong><span>data sources · ${sources.join(" · ")}</span></div><div><strong>${(trace.modelCalls || []).length}</strong><span>Nemotron calls · ${modelText}</span></div><div><strong>${requests}</strong><span>critic-requested queries</span></div><div><strong>${trace.totalRunMs ? `${(trace.totalRunMs / 1000).toFixed(1)} s` : "recorded"}</strong><span>total time</span></div></div>`;
}

function eventList(trace) {
  return [
    ...(trace.plan ? [{ type: "plan", data: trace.plan }] : []),
    ...(trace.modelCalls || []).map((data) => ({ type: "model_call", data })),
    ...(trace.toolCalls || []).map((data) => ({ type: "tool_call", data })),
    ...(trace.criticChallenges || []).map((data) => ({ type: "critic_challenge", data })),
    ...(trace.criticRequests || []).map((data) => ({ type: "critic_request", data })),
    ...(trace.dispositionChanges || []).map((data) => ({ type: "disposition", data })),
  ];
}

function renderTimeline(trace) {
  timeline.replaceChildren();
  for (const event of eventList(trace)) {
    const item = document.createElement("article");
    item.className = `timeline-item timeline-${event.type}`;
    const data = event.data || {};
    const fullLeadId = data.leadId;
    let label = event.type.replaceAll("_", " ");
    let detail = "";
    if (event.type === "plan") label = "Planner produced a typed plan";
    if (event.type === "model_call") { const requested = data.requestedModel || ""; const returned = data.returnedModel || requested; const differs = requested && returned && requested !== returned; label = `${String(data.role || "model").toUpperCase()} · ${shortModel(returned)}${differs ? " · FALLBACK" : ""} · ${formatDuration(data.latencyMs)} · ${String(data.status || "recorded").toUpperCase()}`; detail = ""; item.dataset.modelTooltip = differs ? `requested ${requested}; returned ${returned}` : `requested and returned ${returned}`; }
    if (event.type === "tool_call") { label = `${data.tool} · ${data.rowCount || 0} rows · ${data.durationMs || 0} ms`; detail = `SQL · ${datasource(data.sql)}`; }
    if (event.type === "critic_challenge") { label = `${data.role || "critic"} challenged ${shortLeadId(fullLeadId)}`; detail = challengeFor({ criticChallenges: [data] }, fullLeadId); }
    if (event.type === "critic_request") { label = `${data.tool} · ${data.status} · ${shortLeadId(fullLeadId)}`; detail = `${shortLeadId(fullLeadId)} requested this typed query`; }
    if (event.type === "disposition") { label = `${shortLeadId(fullLeadId)} · ${(data.before || "").toUpperCase()} → ${(data.after || "WITHDRAWN").toUpperCase()}`; detail = data.reason || ""; }
    item.innerHTML = `<div class="timeline-icon">${event.type === "tool_call" ? "DB" : event.type === "model_call" ? "M" : event.type === "critic_challenge" || event.type === "critic_request" ? "C" : event.type === "plan" ? "P" : "Δ"}</div><div class="timeline-content"><div class="timeline-title"><span title="${event.type === "model_call" ? item.dataset.modelTooltip : fullLeadId || ""}">${label}</span></div><div class="timeline-kind">${event.type.replaceAll("_", " ")}</div><p class="timeline-detail">${detail}</p></div>`;
    if (event.type === "plan") {
      const steps = Array.isArray(data.plan) ? data.plan : [];
      const list = document.createElement("ol");
      list.className = "plan-list";
      for (const [index, step] of steps.entries()) { const li = document.createElement("li"); li.textContent = `${index + 1}  ${step.name || "step"} · ${step.description || ""}`; list.append(li); }
      item.querySelector(".timeline-content").append(list);
      const details = document.createElement("details"); details.innerHTML = `<summary>show plan</summary><pre></pre>`; details.querySelector("pre").textContent = JSON.stringify(data, null, 2); item.querySelector(".timeline-content").append(details);
    }
    timeline.append(item);
  }
}

function render(trace, label) {
  question.textContent = trace.question || "Recorded Contract Trail run";
  tracePath.textContent = label || "";
  renderSummary(trace);
  renderTimeline(trace);
  leads.replaceChildren();
  const active = trace.finalLeads || [];
  leadCount.textContent = `${active.length} active`;
  for (const lead of active) leads.append(leadCard(trace, lead));
  const closed = [...(trace.supersededLeads || []).map((item) => [item, "superseded"]), ...(trace.withdrawnLeads || []).map((item) => [item, "withdrawn"])];
  if (closed.length) { const heading = document.createElement("p"); heading.className = "eyebrow closed-heading"; heading.textContent = "Closed leads"; leads.append(heading); for (const [item, state] of closed) leads.append(closedRow(trace, item, state)); }
}

async function loadUrl(url, label) { const response = await fetch(url); if (!response.ok) throw new Error(`Unable to load ${url}`); const trace = await response.json(); render(trace, label); }

async function loadSelected(url) { traceSelect.replaceChildren(); try { await loadUrl(url, url); } catch (error) { question.textContent = error.message; } }

traceFile.addEventListener("change", async () => { const file = traceFile.files?.[0]; if (!file) return; render(JSON.parse(await file.text()), file.name); });
traceSelect.addEventListener("change", () => { if (traceSelect.value) loadSelected(`./traces/${traceSelect.value}`); });

const catalog = await fetch("./traces/index.json").then((response) => response.json());
for (const name of catalog) { const option = document.createElement("option"); option.value = name; option.textContent = name; traceSelect.append(option); }
const requested = new URLSearchParams(location.search).get("trace");
const initial = requested || catalog[0];
if (initial) loadSelected(requested && (requested.includes("/") || requested.startsWith(".")) ? requested : `./traces/${initial}`);
