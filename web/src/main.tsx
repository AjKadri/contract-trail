import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type Lead = {
  id: string;
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  evidenceIds: string[];
  arithmetic: string;
  challengePrompt?: string;
  whatToVerify: string;
  comparison?: string;
};

type ToolTrace = {
  tool: string;
  sql?: string;
  rowCount?: number;
  durationMs?: number;
  resultRows?: unknown[][];
  status?: string;
};

type ModelTrace = {
  role: string;
  requestedModel?: string;
  returnedModel?: string | null;
  latencyMs?: number;
  status?: string;
};

type Trace = {
  tracePath: string;
  mode?: string;
  plan?: unknown;
  totalRunMs?: number;
  toolCalls?: ToolTrace[];
  modelCalls?: ModelTrace[];
  criticChallenges: Array<{ role: string; leadId?: string; challenge: string; disposition?: string }>;
  dispositionChanges: Array<{ leadId: string; before: string; after?: string; disposition: string; reason: string }>;
  criticRequests: Array<{ leadId?: string; tool: string; round: number; status: string }>;
  supersededLeads: Array<{ leadId: string; reason: string }>;
  withdrawnLeads: Array<{ leadId: string; reason: string; severityBefore: string }>;
  reporterModel?: string | null;
};

type RunResult = { trace: Trace; leads: Lead[]; withdrawnLeads: Trace["withdrawnLeads"]; supersededLeads: Trace["supersededLeads"] };
type TimelineEvent = { type: string; data: any; id: number; at: string };
type PriceGap = { federal: number; oyo: number; ratio: number; leaves: string };

const DEFAULT_QUESTION = "Are the exercise-book contracts in federal constituency projects priced fairly compared with what states pay?";
const EVENT_TYPES = ["plan", "tool_call", "model_call", "critic_challenge", "critic_request", "disposition", "status", "error"];

function evidenceUrl(evidenceId: string): string {
  const ocid = evidenceId.split("/")[0];
  return `https://data.open-contracting.org/en/search/?q=${encodeURIComponent(ocid)}`;
}

function dataSources(sql: string): string[] {
  return [...new Set([...sql.matchAll(/(?:FROM|JOIN)\s+([a-z0-9_]+)\./giu)].map((match) => match[1]))];
}

function datasource(sql: string): string {
  const sources = dataSources(sql);
  return sources.length > 1 ? `${sources.join(" + ")} · federated` : sources[0] ?? "ZETARIS";
}

function shortModel(model: string | null | undefined): string {
  if (!model) return "unknown model";
  return model.split("/").at(-1) ?? model;
}

function shortLeadId(leadId: unknown): string {
  const value = typeof leadId === "string" ? leadId : "";
  if (value === "price-gap-federal-vs-oyo") return "price-gap";
  if (value.startsWith("twin-award-")) return "twin-award";
  return value.length > 28 ? `${value.slice(0, 25)}…` : value || "lead";
}

function formatMoney(value: number): string {
  return `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(Math.round(value))}`;
}

function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds == null) return "in progress";
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

function parsePriceGap(lead: Lead): PriceGap | null {
  const match = lead.arithmetic.match(/Federal median\s+([\d,.]+)\s+NGN\/book\s+÷\s+Oyo median\s+([\d,.]+)\s+NGN\/book\s+=\s+([\d,.]+)×\s+on matched leaves\s+([^,]+)/iu);
  if (!match) return null;
  const federal = Number(match[1].replaceAll(",", ""));
  const oyo = Number(match[2].replaceAll(",", ""));
  const ratio = Number(match[3].replaceAll(",", ""));
  return [federal, oyo, ratio].every(Number.isFinite) ? { federal, oyo, ratio, leaves: match[4].trim() } : null;
}

function headlineFor(lead: Lead): string {
  const gap = parsePriceGap(lead);
  if (gap) return `Federal exercise books cost ${gap.ratio.toFixed(1)}× what Oyo paid, matched on leaf count`;
  return lead.title;
}

function eventLabel(event: TimelineEvent): string {
  const data = event.data ?? {};
  if (event.type === "plan") return "Planner produced a typed plan";
  if (event.type === "tool_call") return data.tool ?? "Typed Zetaris query";
  if (event.type === "model_call") return data.role ?? "Model call";
  if (event.type === "critic_challenge") return `${data.role ?? "critic"} challenged ${shortLeadId(data.leadId)}`;
  if (event.type === "critic_request") return data.tool ?? "Critic-requested query";
  if (event.type === "disposition") return `${shortLeadId(data.leadId)} · ${String(data.before).toUpperCase()} → ${String(data.after ?? "WITHDRAWN").toUpperCase()}`;
  if (event.type === "status") return data.status === "running" ? "Investigation started" : data.status;
  return data.message ?? "Run error";
}

function eventSourceLabel(event: TimelineEvent): string {
  const data = event.data ?? {};
  if (event.type === "tool_call") return datasource(data.sql ?? "");
  if (event.type === "model_call") return shortModel(data.returnedModel ?? data.requestedModel);
  if (event.type === "plan") return "NEMOTRON ULTRA";
  if (event.type === "critic_challenge" || event.type === "critic_request") return "DEFENCE CRITIC";
  if (event.type === "disposition") return "RULES ENGINE";
  if (event.type === "status") return "RUN";
  return "SYSTEM";
}

function eventMetric(event: TimelineEvent): string {
  const data = event.data ?? {};
  if (event.type === "tool_call") return `${data.durationMs ?? 0} ms`;
  if (event.type === "model_call") return `${data.latencyMs ?? 0} ms`;
  return formatTime(event.at);
}

function eventIcon(type: string): string {
  if (type === "plan") return "P";
  if (type === "tool_call") return "DB";
  if (type === "model_call") return "M";
  if (type === "critic_challenge" || type === "critic_request") return "C";
  if (type === "disposition") return "Δ";
  if (type === "memory") return "H";
  return "·";
}

function parseJsonString(value: unknown): unknown | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

function objectValue(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function JsonDisclosure({ label, value }: { label: string; value: unknown }) {
  return <details className="json-disclosure"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 170;
  return <div><p className={!expanded && canExpand ? "clamp-2" : undefined}>{text}</p>{canExpand ? <button className="read-more" onClick={() => setExpanded((value) => !value)}>{expanded ? "show less" : "read more"}</button> : null}</div>;
}

function PlanView({ value }: { value: unknown }) {
  const steps = value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).plan) ? (value as Record<string, unknown>).plan : [];
  return <div className="plan-view">
    {steps.length ? <ol className="plan-list">{steps.map((step, index) => {
      const record = step && typeof step === "object" ? step as Record<string, unknown> : {};
      const line = [record.name, record.description].filter((part): part is string => typeof part === "string").join(" · ") || JSON.stringify(step);
      return <li key={index}><span className="plan-number">{index + 1}</span><span>{line}</span></li>;
    })}</ol> : null}
    <JsonDisclosure label="show plan" value={value} />
  </div>;
}

function challengeText(data: any, expectedLeadId?: string): { summary: string; raw: unknown | null } {
  const raw = parseJsonString(data.challenge);
  const embeddedLeadId = objectValue(raw, "leadId");
  if (expectedLeadId && embeddedLeadId && embeddedLeadId !== expectedLeadId) return { summary: "No challenge recorded for this lead.", raw: null };
  return { summary: objectValue(raw, "challenge") ?? objectValue(raw, "reason") ?? data.challenge ?? "No challenge recorded.", raw };
}

function dispositionOutcome(change: Trace["dispositionChanges"][number]): string {
  if (change.disposition === "withdraw") return "Withdrawn by the defence critic after review.";
  if (change.disposition === "stand") return `The defence critic let this lead stand at ${String(change.after ?? change.before).toUpperCase()}.`;
  return `The defence critic downgraded this lead from ${change.before.toUpperCase()} to ${(change.after ?? "LOW").toUpperCase()}.`;
}

function evidenceMeta(trace: Trace, evidenceId: string): { title?: string; value?: number } {
  const ocid = evidenceId.split("/")[0];
  for (const call of trace.toolCalls ?? []) {
    for (const row of call.resultRows ?? []) {
      if (String(row[1] ?? "") === ocid) return { title: String(row[3] ?? "") || undefined, value: typeof row[5] === "number" ? row[5] : Number(row[5]) };
      if (String(row[0] ?? "") === ocid) return { title: String(row[3] ?? "") || undefined, value: typeof row[4] === "number" ? row[4] : Number(row[4]) };
    }
  }
  return {};
}

function dispositionCopy(change: Trace["dispositionChanges"][number]): string {
  if (change.disposition === "withdraw") return "withdrawn by defence critic";
  if (change.disposition === "stand") return "stood by defence critic";
  return "downgraded by defence critic";
}

function LeadCard({ lead, trace, onDismiss }: { lead: Lead; trace: Trace; onDismiss: (leadId: string) => void }) {
  const challenge = trace.criticChallenges.filter((entry) => entry.leadId === lead.id).at(-1);
  const change = trace.dispositionChanges.find((entry) => entry.leadId === lead.id);
  const gap = parsePriceGap(lead);
  return <article className={`lead-card severity-bar-${lead.severity}`}>
    <div className="lead-card-head"><span className={`severity severity-${lead.severity}`}>{lead.severity}</span><span className="lead-kicker">LEAD TO VERIFY</span></div>
    <h3>{headlineFor(lead)}</h3>
    {gap ? <div className="hero-result"><span className="hero-result-label">PRICE GAP / MATCHED LEAVES</span><strong>{gap.ratio.toFixed(1)}×</strong></div> : null}
    {gap ? <div className="price-pair"><div><span>Federal median</span><strong>{formatMoney(gap.federal)}</strong></div><span className="pair-divider">vs</span><div><span>Oyo median</span><strong>{formatMoney(gap.oyo)}</strong></div></div> : null}
    <p className="arithmetic">{lead.arithmetic}</p>
    {change ? <div className="disposition-line"><s>{change.before.toUpperCase()}</s><span>→</span><strong>{(change.after ?? "withdrawn").toUpperCase()}</strong><span>· {dispositionCopy(change)}</span></div> : null}
    <section className="evidence-block"><p className="eyebrow">03 — Evidence</p><div className="evidence-table"><div className="evidence-table-head"><span>OCID</span><span>Title</span><span>Value</span><span>Link</span></div>{lead.evidenceIds.slice(0, 8).map((id) => { const meta = evidenceMeta(trace, id); const value = meta.value != null && Number.isFinite(meta.value) ? formatMoney(meta.value) : "—"; return <div className="evidence-record" key={id} data-tooltip={`${meta.title ?? id} · ${value}`}><a href={evidenceUrl(id)} target="_blank" rel="noreferrer" className="evidence-ocid">{id.split("/")[0]}</a><span className="evidence-title">{meta.title ?? "Recorded contract"}</span><span className="evidence-value">{value}</span><a href={evidenceUrl(id)} target="_blank" rel="noreferrer" className="evidence-link">OPEN ↗</a></div>; })}</div></section>
    <section className="quote-block"><p className="eyebrow">Defence critic says</p><ExpandableText text={challenge ? challengeText(challenge, lead.id).summary : "No challenge recorded."} />{challenge && challengeText(challenge, lead.id).raw ? <JsonDisclosure label="show JSON" value={challengeText(challenge, lead.id).raw} /> : null}</section>
    <section className="answer-block"><p className="eyebrow">Answer</p><ExpandableText text={change ? dispositionOutcome(change) : "The evidence remains open for verification."} /></section>
    <section className="verify-block"><p className="eyebrow">Verify on the ground</p><p>{lead.whatToVerify}</p></section>
    <button className="dismiss-button" onClick={() => onDismiss(lead.id)}>Dismiss</button>
  </article>;
}

function ClosedLeadRow({ lead, state, reason }: { lead: Lead; state: "superseded" | "withdrawn"; reason: string }) {
  return <details className="closed-row"><summary><span className="closed-row-title">{headlineFor(lead)}</span><span className="closed-row-state">{state}</span><span className="closed-row-reason">{reason}</span></summary><p>{reason}</p></details>;
}

function RunSummary({ trace, events, sampleMode }: { trace: Trace | null; events: TimelineEvent[]; sampleMode: boolean }) {
  const tools = trace?.toolCalls ?? events.filter((event) => event.type === "tool_call").map((event) => event.data as ToolTrace);
  const models = trace?.modelCalls ?? events.filter((event) => event.type === "model_call").map((event) => event.data as ModelTrace);
  const criticRequests = trace?.criticRequests ?? events.filter((event) => event.type === "critic_request" && event.data.status === "executed").map((event) => event.data);
  const sources = [...new Set(tools.flatMap((tool) => dataSources(tool.sql ?? "")))];
  const modelCounts = new Map<string, number>();
  for (const model of models) { const name = shortModel(model.returnedModel ?? model.requestedModel); modelCounts.set(name, (modelCounts.get(name) ?? 0) + 1); }
  const modelText = [...modelCounts.entries()].map(([model, count]) => `${model} ×${count}`).join(" · ") || "none yet";
  return <div className="summary-strip"><div className="summary-strip-head"><p className="eyebrow">Run summary</p><span className={sampleMode ? "replayed-badge" : "live-badge"}>{sampleMode ? "REPLAYED" : "LIVE"}</span></div><div className="summary-grid"><div><strong>{tools.length}</strong><span>Zetaris queries</span></div><div><strong>{sources.length || "—"}</strong><span>data sources · {sources.join(" · ") || "awaiting query"}</span></div><div><strong>{models.length}</strong><span>Nemotron calls · {modelText}</span></div><div><strong>{criticRequests.length}</strong><span>{criticRequests.length === 1 ? "critic-requested query" : "critic-requested queries"}</span></div><div><strong>{formatDuration(trace?.totalRunMs)}</strong><span>total time</span></div></div></div>;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return <div className="timeline">
    {events.map((event) => {
      const data = event.data ?? {};
      const challenge = event.type === "critic_challenge" ? challengeText(data, typeof data.leadId === "string" ? data.leadId : undefined) : null;
      const fullLeadId = typeof data.leadId === "string" ? data.leadId : undefined;
      return <div className={`timeline-item timeline-${event.type}`} key={event.id}><span className="timeline-index">{String(event.id + 1).padStart(2, "0")}</span><div className="timeline-icon">{eventIcon(event.type)}</div><div className="timeline-content"><div className="timeline-title"><span className="timeline-main" title={fullLeadId}>{eventLabel(event)}</span><span className="timeline-metric">{eventMetric(event)}</span></div><div className="timeline-kind"><span className="timeline-source">{eventSourceLabel(event)}</span><span>{event.type.replaceAll("_", " ")}</span></div>{event.type === "tool_call" ? <details><summary>SQL · {datasource(data.sql ?? "")}</summary><pre>{data.sql}</pre></details> : null}{event.type === "model_call" ? <p className="timeline-detail">requested {shortModel(data.requestedModel)} · returned {shortModel(data.returnedModel)}{data.status ? ` · ${data.status}` : ""}</p> : null}{event.type === "critic_challenge" && challenge ? <><p className="timeline-detail"><ExpandableText text={challenge.summary} /></p>{challenge.raw ? <JsonDisclosure label="show JSON" value={challenge.raw} /> : null}</> : null}{event.type === "critic_request" ? <p className="timeline-detail"><span title={fullLeadId}>{shortLeadId(data.leadId)}</span> requested this typed query</p> : null}{event.type === "disposition" ? <p className="timeline-detail"><s>{String(data.before).toUpperCase()}</s> → <strong>{String(data.after ?? "WITHDRAWN").toUpperCase()}</strong> · {data.reason}</p> : null}{event.type === "plan" ? <PlanView value={data} /> : null}</div></div>;
    })}
    {!events.length ? <p className="empty-state">The investigation log will appear here as the case runs.</p> : null}
  </div>;
}

function App() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<Lead[]>([]);
  const [running, setRunning] = useState(false);
  const [sampleMode, setSampleMode] = useState(false);
  const [dark, setDark] = useState(false);
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { fetch("/api/config").then((response) => response.json()).then((config) => setSampleMode(Boolean(config.sampleMode))).catch(() => undefined); }, []);

  const supersededMap = useMemo(() => new Map((result?.supersededLeads ?? []).map((item) => [item.leadId, item.reason])), [result]);
  const withdrawnMap = useMemo(() => new Map((result?.withdrawnLeads ?? []).map((item) => [item.leadId, item.reason])), [result]);
  const priorLeads = history.filter((lead) => supersededMap.has(lead.id) || withdrawnMap.has(lead.id));

  function addEvent(type: string, data: any) { setEvents((current) => [...current, { type, data, id: current.length, at: new Date().toISOString() }]); }

  function runInvestigation(questionOverride?: string) {
    if (running) return;
    const targetQuestion = questionOverride ?? question;
    setQuestion(targetQuestion);
    setRunning(true);
    setNotice("");
    setResult(null);
    setEvents([]);
    const source = new EventSource(`/api/run?question=${encodeURIComponent(targetQuestion)}`);
    for (const type of EVENT_TYPES) source.addEventListener(type, (event) => addEvent(type, JSON.parse((event as MessageEvent).data)));
    source.addEventListener("done", (event) => { const next = JSON.parse((event as MessageEvent).data) as RunResult; setResult(next); setHistory((current) => { const merged = new Map([...current, ...next.leads].map((lead) => [lead.id, lead])); return [...merged.values()]; }); setRunning(false); source.close(); });
    source.addEventListener("error", (event) => { const message = (event as MessageEvent).data ? JSON.parse((event as MessageEvent).data).message : "The stream closed before completion."; setNotice(message); setRunning(false); source.close(); });
  }

  async function dismiss() {
    if (!dismissId || !reason.trim()) return;
    const response = await fetch("/api/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: dismissId, reason }) });
    const body = await response.json();
    if (!response.ok) { setNotice(body.error ?? "Dismissal failed"); return; }
    setNotice(`Dismissed ${dismissId}. The next run will show it as superseded.`);
    setDismissId(null);
    setReason("");
  }

  async function resetMemory() { await fetch("/api/memory/reset", { method: "POST" }); setResult(null); setHistory([]); setEvents([]); setNotice("Memory reset for the next demo take."); }

  return <main className={dark ? "app dark" : "app"}>
    <header className="topbar"><div className="brand-lockup"><span className="ct-monogram">CT</span><div className="brand-wordmark">CONTRACT TRAIL</div></div><div className="top-actions"><span className="disclaimer">Leads, not accusations</span><div className="status-cells"><span className={sampleMode ? "status-cell status-replayed" : "status-cell status-live"}>{sampleMode ? "REPLAYED" : "LIVE"}</span><span className="status-cell">NIGHTSHIFT</span><span className="status-cell">ZETARIS</span><span className="status-cell">H-MEM</span></div><button className="quiet-button" onClick={resetMemory}>Reset memory</button><button className="quiet-button" onClick={() => setDark((value) => !value)}>{dark ? "Light mode" : "Dark mode"}</button></div></header>
    <section className="question-bar"><div className="question-intro"><p className="section-label">00 — QUESTION</p><p className="eyebrow">Illustrative reporter · Amaka, Lagos newsroom</p><h1>Investigate a procurement question.</h1></div><div className="question-controls"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Investigation question" /><button className="run-button" onClick={() => runInvestigation()} disabled={running}>{running ? "Investigating…" : "Run investigation"}</button></div></section>
    {notice ? <div className="notice">{notice}</div> : null}
    <section className="workspace"><section className="log-column"><div className="column-heading"><div><p className="section-label">01 — Investigation log</p><h2>Investigation log</h2></div>{running ? <span className="live-indicator">LIVE</span> : null}</div><Timeline events={events} />{result ? <div className="run-meta"><span>{result.trace.tracePath}</span><span>{formatDuration(result.trace.totalRunMs)}</span><span>Reporter: {shortModel(result.trace.reporterModel)}</span></div> : null}</section><section className="leads-column"><RunSummary trace={result?.trace ?? null} events={events} sampleMode={sampleMode} /><div className="column-heading leads-heading"><div><p className="section-label">02 — Leads</p><h2>Leads to verify</h2></div>{result ? <span className="lead-count">{result.leads.length} active</span> : null}</div>{result?.leads.map((lead) => <LeadCard key={lead.id} lead={lead} trace={result.trace} onDismiss={(id) => setDismissId(id)} />)}{dismissId ? <div className="dismiss-panel"><p className="eyebrow">Dismiss lead</p><p>Record the reporter’s reason in H-MEM.</p><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why should this lead be superseded?" /><div><button className="run-button" onClick={dismiss}>Save decision</button><button className="quiet-button" onClick={() => setDismissId(null)}>Cancel</button></div></div> : null}{result && !running && notice.startsWith("Dismissed") ? <button className="rerun-button" onClick={() => runInvestigation()}>Rerun investigation</button> : null}{priorLeads.length ? <div className="muted-leads"><p className="section-label">04 — Closed leads</p>{priorLeads.map((lead) => supersededMap.has(lead.id) ? <ClosedLeadRow key={`closed-${lead.id}`} lead={lead} state="superseded" reason={supersededMap.get(lead.id) ?? ""} /> : <ClosedLeadRow key={`closed-${lead.id}`} lead={lead} state="withdrawn" reason={withdrawnMap.get(lead.id) ?? ""} />)}</div> : null}{!result ? <div className="empty-leads"><p>Ask a question and Contract Trail will query Zetaris, challenge the evidence, and return leads to verify.</p><button className="try-button" onClick={() => runInvestigation(DEFAULT_QUESTION)}>Try: Amaka’s question</button></div> : null}</section></section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
