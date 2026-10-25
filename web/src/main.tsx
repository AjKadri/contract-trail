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
  whatToVerify: string;
};

type Trace = {
  tracePath: string;
  totalRunMs?: number;
  criticChallenges: Array<{ role: string; leadId?: string; challenge: string }>;
  dispositionChanges: Array<{ leadId: string; before: string; after?: string; disposition: string; reason: string }>;
  criticRequests: Array<{ leadId?: string; tool: string; round: number; status: string }>;
  supersededLeads: Array<{ leadId: string; reason: string }>;
  withdrawnLeads: Array<{ leadId: string; reason: string; severityBefore: string }>;
  reporterModel?: string | null;
};

type RunResult = { trace: Trace; leads: Lead[]; withdrawnLeads: Trace["withdrawnLeads"]; supersededLeads: Trace["supersededLeads"] };
type TimelineEvent = { type: string; data: any; id: number };

const DEFAULT_QUESTION = "Are the exercise-book contracts in federal constituency projects priced fairly compared with what states pay?";
const EVENT_TYPES = ["plan", "tool_call", "model_call", "critic_challenge", "critic_request", "disposition", "status", "error"];

function evidenceUrl(evidenceId: string): string {
  const ocid = evidenceId.split("/")[0];
  return `https://data.open-contracting.org/en/search/?q=${encodeURIComponent(ocid)}`;
}

function datasource(sql: string): string {
  const match = sql.match(/(?:FROM|JOIN)\s+([a-z0-9_]+)\./iu);
  return match?.[1] ?? "ZETARIS";
}

function shortModel(model: string | null | undefined): string {
  if (!model) return "unknown model";
  return model.split("/").at(-1) ?? model;
}

function eventLabel(event: TimelineEvent): string {
  const data = event.data ?? {};
  if (event.type === "plan") return "Planner produced a typed plan";
  if (event.type === "tool_call") return `${data.tool} · ${data.rowCount ?? 0} rows · ${data.durationMs ?? 0} ms`;
  if (event.type === "model_call") return `${data.role} · ${shortModel(data.returnedModel)} · ${data.latencyMs ?? 0} ms`;
  if (event.type === "critic_challenge") return `${data.role ?? "critic"} challenged ${data.leadId ?? "a lead"}`;
  if (event.type === "critic_request") return `${data.tool} · ${data.status} · round ${data.round}`;
  if (event.type === "disposition") return `${data.leadId} · ${String(data.before).toUpperCase()} → ${String(data.after ?? "WITHDRAWN").toUpperCase()}`;
  if (event.type === "status") return data.status === "running" ? "Investigation started" : data.status;
  return data.message ?? "Run error";
}

function LeadCard({ lead, trace, onDismiss, superseded, withdrawn }: { lead: Lead; trace: Trace; onDismiss: (leadId: string) => void; superseded?: string; withdrawn?: string }) {
  const challenge = trace.criticChallenges.filter((entry) => entry.leadId === lead.id).at(-1);
  const change = trace.dispositionChanges.find((entry) => entry.leadId === lead.id);
  return (
    <article className={`lead-card ${superseded || withdrawn ? "lead-card-muted" : ""}`}>
      <div className="lead-card-head">
        <span className={`severity severity-${lead.severity}`}>{lead.severity}</span>
        {superseded ? <span className="state-label">SUPERSEDED</span> : withdrawn ? <span className="state-label">WITHDRAWN</span> : null}
      </div>
      <h3>{lead.title}</h3>
      <p className="arithmetic">{lead.arithmetic}</p>
      <div className="evidence-row">
        {lead.evidenceIds.slice(0, 8).map((id) => <a key={id} href={evidenceUrl(id)} target="_blank" rel="noreferrer" className="evidence-chip">{id.split("/")[0]}</a>)}
      </div>
      <section className="quote-block">
        <p className="eyebrow">Defence critic says</p>
        <p>{challenge?.challenge ?? "No challenge recorded."}</p>
      </section>
      <section className="answer-block">
        <p className="eyebrow">Answer</p>
        <p>{change?.reason ?? "The evidence remains open for verification."}</p>
      </section>
      <section className="verify-block">
        <p className="eyebrow">Verify on the ground</p>
        <p>{lead.whatToVerify}</p>
      </section>
      {superseded ? <p className="muted-reason">Superseded by reporter decision: {superseded}</p> : withdrawn ? <p className="muted-reason">Withdrawn: {withdrawn}</p> : <button className="dismiss-button" onClick={() => onDismiss(lead.id)}>Dismiss</button>}
    </article>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="timeline">
      {events.map((event) => {
        const data = event.data ?? {};
        return (
          <div className={`timeline-item timeline-${event.type}`} key={event.id}>
            <div className="timeline-dot" />
            <div className="timeline-content">
              <div className="timeline-title"><span>{eventLabel(event)}</span><span className="timeline-kind">{event.type.replaceAll("_", " ")}</span></div>
              {event.type === "tool_call" ? <details><summary>SQL · {datasource(data.sql ?? "")}</summary><pre>{data.sql}</pre></details> : null}
              {event.type === "model_call" ? <p className="timeline-detail">requested {shortModel(data.requestedModel)} · returned {shortModel(data.returnedModel)}{data.status ? ` · ${data.status}` : ""}</p> : null}
              {event.type === "critic_challenge" ? <p className="timeline-detail">{data.challenge}</p> : null}
              {event.type === "critic_request" ? <p className="timeline-detail">{data.leadId ?? "lead"} requested this typed query</p> : null}
              {event.type === "disposition" ? <p className="timeline-detail"><s>{String(data.before).toUpperCase()}</s> → <strong>{String(data.after ?? "WITHDRAWN").toUpperCase()}</strong> · {data.reason}</p> : null}
              {event.type === "plan" ? <pre>{JSON.stringify(data, null, 2)}</pre> : null}
            </div>
          </div>
        );
      })}
      {!events.length ? <p className="empty-state">The investigation log will appear here as the case runs.</p> : null}
    </div>
  );
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

  useEffect(() => {
    fetch("/api/config").then((response) => response.json()).then((config) => setSampleMode(Boolean(config.sampleMode))).catch(() => undefined);
  }, []);

  const supersededMap = useMemo(() => new Map((result?.supersededLeads ?? []).map((item) => [item.leadId, item.reason])), [result]);
  const withdrawnMap = useMemo(() => new Map((result?.withdrawnLeads ?? []).map((item) => [item.leadId, item.reason])), [result]);
  const priorLeads = history.filter((lead) => supersededMap.has(lead.id) || withdrawnMap.has(lead.id));

  function addEvent(type: string, data: any) {
    setEvents((current) => [...current, { type, data, id: current.length }]);
  }

  function runInvestigation() {
    if (running) return;
    setRunning(true);
    setNotice("");
    setResult(null);
    setEvents([]);
    const source = new EventSource(`/api/run?question=${encodeURIComponent(question)}`);
    for (const type of EVENT_TYPES) source.addEventListener(type, (event) => addEvent(type, JSON.parse((event as MessageEvent).data)));
    source.addEventListener("done", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as RunResult;
      setResult(next);
      setHistory((current) => {
        const merged = new Map([...current, ...next.leads].map((lead) => [lead.id, lead]));
        return [...merged.values()];
      });
      setRunning(false);
      source.close();
    });
    source.addEventListener("error", (event) => {
      const message = (event as MessageEvent).data ? JSON.parse((event as MessageEvent).data).message : "The stream closed before completion.";
      setNotice(message);
      setRunning(false);
      source.close();
    });
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

  async function resetMemory() {
    await fetch("/api/memory/reset", { method: "POST" });
    setResult(null);
    setHistory([]);
    setEvents([]);
    setNotice("Memory reset for the next demo take.");
  }

  return (
    <main className={dark ? "app dark" : "app"}>
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">CT</span><div><p className="brand-name">Contract Trail</p><p className="brand-kicker">Public procurement case file</p></div></div>
        <div className="top-actions"><span className="disclaimer">Leads, not accusations</span>{sampleMode ? <span className="replayed-badge">REPLAYED</span> : null}<button className="quiet-button" onClick={resetMemory}>Reset memory</button><button className="quiet-button" onClick={() => setDark((value) => !value)}>{dark ? "Light mode" : "Dark mode"}</button></div>
      </header>
      <section className="question-bar">
        <div><p className="eyebrow">Illustrative reporter · Amaka, Lagos newsroom</p><h1>Investigate a procurement question.</h1></div>
        <div className="question-controls"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Investigation question" /><button className="run-button" onClick={runInvestigation} disabled={running}>{running ? "Investigating…" : "Run investigation"}</button></div>
      </section>
      {notice ? <div className="notice">{notice}</div> : null}
      <section className="workspace">
        <section className="log-column"><div className="column-heading"><div><p className="eyebrow">Live trace</p><h2>Investigation log</h2></div>{running ? <span className="live-indicator">LIVE</span> : null}</div><Timeline events={events} />{result ? <div className="run-meta"><span>{result.trace.tracePath}</span><span>{result.trace.totalRunMs ?? 0} ms</span><span>Reporter: {shortModel(result.trace.reporterModel)}</span></div> : null}</section>
        <section className="leads-column"><div className="column-heading"><div><p className="eyebrow">Evidence desk</p><h2>Leads to verify</h2></div>{result ? <span className="lead-count">{result.leads.length} active</span> : null}</div>{result?.leads.map((lead) => <LeadCard key={lead.id} lead={lead} trace={result.trace} onDismiss={(id) => setDismissId(id)} />)}{dismissId ? <div className="dismiss-panel"><p className="eyebrow">Dismiss lead</p><p>Record the reporter’s reason in H-MEM.</p><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why should this lead be superseded?" /><div><button className="run-button" onClick={dismiss}>Save decision</button><button className="quiet-button" onClick={() => setDismissId(null)}>Cancel</button></div></div> : null}{result && !running && notice.startsWith("Dismissed") ? <button className="rerun-button" onClick={runInvestigation}>Rerun investigation</button> : null}{priorLeads.length ? <div className="muted-leads"><p className="eyebrow">Closed leads</p>{priorLeads.map((lead) => <LeadCard key={`closed-${lead.id}`} lead={lead} trace={result?.trace ?? { criticChallenges: [], dispositionChanges: [], criticRequests: [], supersededLeads: [], withdrawnLeads: [] }} onDismiss={() => undefined} superseded={supersededMap.get(lead.id)} withdrawn={withdrawnMap.get(lead.id)} />)}</div> : null}{!result ? <div className="empty-leads"><p className="eyebrow">No case loaded</p><p>Run Amaka’s question to populate cited, pre-challenged leads.</p></div> : null}</section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
