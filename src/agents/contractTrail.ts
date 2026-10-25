import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { HMEM } from "../engines/hmem/index.js";
import type { MemoryRecord } from "../engines/hmem/types.js";
import { runZetarisSql, rows } from "../../scripts/zetaris/client.js";
import { buildTypedQuery, buildToolSelectionPrompt, isKnownQueryTool, toolNameList, type QueryToolName } from "../data/queries.js";
import { callNightshift, deepModel, fastModel, parseJsonArray, parseJsonObject, type CallOptions, type ModelCallLog, type ModelCallResult } from "../llm/nightshift.js";
import {
  applyLeadDispositions,
  buildDeterministicLeads,
  buildLeafMatchedComparison,
  federalItemsToPriced,
  federalToLeafPrices,
  numberValue,
  oyoToLeafPrices,
  oyoToPriced,
  normaliseSupplierName,
  textValue,
  yearOf,
  type CpiPoint,
  type DeterministicLead,
  type FederalContract,
  type FederalItem,
  type LeadDisposition,
  type LeafMatchedComparison,
  type OyoContract,
  type PricedContract,
} from "../rules/procurement.js";

dotenv.config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

export const DEFAULT_QUESTION = "Are the exercise-book contracts in federal constituency projects priced fairly compared with what states pay?";
const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const HMEM_DIR = resolve(ROOT, "runs/.hmem");

export type ToolTrace = {
  tool: QueryToolName;
  params: Record<string, unknown>;
  sql: string;
  limit: number;
  startedAt: string;
  durationMs: number;
  rowCount: number;
  resultRows: unknown[][];
  status: "ok" | "error";
  requestedBy?: "planner" | "data-agent" | "critic";
  error?: string;
};

export type TracedModelCall = ModelCallLog & { output?: string };
export type CriticRequestTrace = { leadId?: string; tool: QueryToolName; params: Record<string, unknown>; round: number; status: "executed" | "rejected" | "bounded"; reason?: string };
export type DispositionTrace = { leadId: string; disposition: LeadDisposition["disposition"]; reason: string; before: DeterministicLead["severity"]; after?: DeterministicLead["severity"] };
export type SupersededLead = { leadId: string; memoryId: string; reason: string };

export type RunTrace = {
  version: 2;
  mode: "LIVE" | "REPLAYED";
  question: string;
  startedAt: string;
  plan: unknown;
  plannerChosenTools: QueryToolName[];
  selectedTools: QueryToolName[];
  toolSelectionNotes: string[];
  toolCalls: ToolTrace[];
  modelCalls: TracedModelCall[];
  modelOutputs: Record<string, string>;
  criticChallenges: Array<{ role: string; leadId?: string; challenge: string; disposition?: string }>;
  criticRequests: CriticRequestTrace[];
  dispositionChanges: DispositionTrace[];
  validationFailures: Array<{ leadId: string; missingTools: QueryToolName[]; reason: string }>;
  withdrawnLeads: Array<{ leadId: string; reason: string; severityBefore: DeterministicLead["severity"] }>;
  supersededLeads: SupersededLead[];
  finalLeads: unknown[];
  reporterOutput?: string;
  reporterModel?: string | null;
  supplierContext: Array<{ supplier: string; bppAwards: number; osunAwards: number }>;
  leafMatchedComparison?: LeafMatchedComparison;
  memoryReads: unknown[];
  memoryWrites: unknown[];
  totalRunMs?: number;
};

export type RunResult = { trace: RunTrace; tracePath: string; leads: DeterministicLead[]; withdrawnLeads: RunTrace["withdrawnLeads"]; supersededLeads: SupersededLead[] };
export type DismissalResult = { leadId: string; reason: string; previousMemoryId: string; memory: MemoryRecord; tracePath: string };
export type RunOptions = { memoryFile?: string; onEvent?: (event: TraceEvent) => void };
export type TraceEvent = { type: "plan" | "tool_call" | "model_call" | "critic_challenge" | "critic_request" | "disposition"; data: unknown };

function asFederalContract(row: unknown[]): FederalContract { return { id: textValue(row[0]), mainOcid: textValue(row[1]), mainId: textValue(row[2]), title: textValue(row[3]), dateSigned: textValue(row[4]), value: numberValue(row[5]), currency: textValue(row[6]) }; }
function asFederalItem(row: unknown[]): FederalItem { return { contractId: textValue(row[0]), mainOcid: textValue(row[1]), mainId: textValue(row[2]), title: textValue(row[3]), dateSigned: textValue(row[4]), value: numberValue(row[5]), currency: textValue(row[6]), itemId: textValue(row[7]), quantity: numberValue(row[8]), description: textValue(row[9]) }; }
function asOyoContract(row: unknown[]): OyoContract { return { ocid: textValue(row[0]), id: textValue(row[1]), date: textValue(row[2]), title: textValue(row[3]), value: numberValue(row[4]), currency: textValue(row[5]), buyer: textValue(row[6]), procuringEntity: textValue(row[7]) }; }
function asCpiPoint(row: unknown[]): CpiPoint { return { year: yearOf(textValue(row[0])), value: numberValue(row[1]) }; }

function addModelLogs(trace: RunTrace, logs: ModelCallLog[], output: string, role: string, onEvent?: (event: TraceEvent) => void): void {
  for (const log of logs) {
    const traced = { ...log, output: log.role === role ? output : undefined };
    trace.modelCalls.push(traced);
    onEvent?.({ type: "model_call", data: { ...log } });
  }
  trace.modelOutputs[role] = output;
}

const THINKING_OFF = { enable_thinking: false };

function memoryBinding(memoryFile?: string): { persistDir: string; file?: string } {
  if (!memoryFile) return { persistDir: HMEM_DIR };
  const file = resolve(memoryFile);
  const persistDir = resolve(dirname(file), `.contract-trail-memory-${basename(file).replace(/[^a-z0-9._-]/giu, "-")}`);
  mkdirSync(persistDir, { recursive: true });
  const stateFile = join(persistDir, "state.json");
  if (existsSync(file) && !existsSync(stateFile)) copyFileSync(file, stateFile);
  return { persistDir, file };
}

function syncMemoryFile(binding: { persistDir: string; file?: string }): void {
  if (!binding.file) return;
  const stateFile = join(binding.persistDir, "state.json");
  if (existsSync(stateFile)) copyFileSync(stateFile, binding.file);
}

async function callAndRecord(trace: RunTrace, options: CallOptions, onEvent?: (event: TraceEvent) => void): Promise<ModelCallResult> {
  try {
    const result = await callNightshift(options);
    addModelLogs(trace, result.logs, result.content, options.role, onEvent);
    return result;
  } catch (error) {
    const failed = error as Error & { modelLogs?: ModelCallLog[]; callLog?: ModelCallLog };
    const logs = failed.modelLogs ?? (failed.callLog ? [failed.callLog] : []);
    for (const log of logs) {
      trace.modelCalls.push({ ...log, output: undefined });
      onEvent?.({ type: "model_call", data: { ...log } });
    }
    trace.modelOutputs[options.role] = `ERROR: ${failed.message}`;
    return { content: "", returnedModel: null, logs };
  }
}

function planFallback(): Record<string, unknown> { return { steps: ["Find federal exercise-book purchases", "Find Oyo exercise-book purchases", "Use CPI and deterministic price rules", "Check twin awards and ask critics to challenge each lead"] }; }

function selectedToolsFrom(content: string): QueryToolName[] {
  const value = parseJsonObject(content).tools;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isKnownQueryTool))];
}

function parseCriticEntries(content: string, leadIds: string[]): { decisions: LeadDisposition[]; requests: CriticRequestTrace[]; challenges: RunTrace["criticChallenges"] } {
  const object = parseJsonObject(content);
  const array = parseJsonArray(content);
  const rawEntries = array.length ? array : Array.isArray(object.decisions) ? object.decisions : object.leadId ? [object] : [];
  const decisions: LeadDisposition[] = [];
  const requests: CriticRequestTrace[] = [];
  const challenges: RunTrace["criticChallenges"] = [];
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const leadId = textValue(entry.leadId ?? entry.lead_id);
    const reason = textValue(entry.reason ?? entry.challenge ?? entry.explanation);
    const disposition = textValue(entry.disposition).toLowerCase();
    if (leadIds.includes(leadId) && (disposition === "stand" || disposition === "downgrade" || disposition === "withdraw")) decisions.push({ leadId, disposition, reason: reason || "Critic supplied no reason" });
    if (reason) challenges.push({ role: "defence-critic", leadId: leadIds.includes(leadId) ? leadId : undefined, challenge: reason, disposition: disposition || undefined });
    const needs = entry.needs;
    if (needs && typeof needs === "object") {
      const need = needs as Record<string, unknown>;
      if (isKnownQueryTool(need.tool)) requests.push({ leadId: leadIds.includes(leadId) ? leadId : undefined, tool: need.tool, params: need.params && typeof need.params === "object" && !Array.isArray(need.params) ? need.params as Record<string, unknown> : {}, round: 0, status: "executed" });
    }
  }
  const topNeeds = object.needs;
  if (topNeeds && typeof topNeeds === "object") {
    const need = topNeeds as Record<string, unknown>;
    if (isKnownQueryTool(need.tool)) requests.push({ tool: need.tool, params: need.params && typeof need.params === "object" && !Array.isArray(need.params) ? need.params as Record<string, unknown> : {}, round: 0, status: "executed" });
  }
  return { decisions, requests, challenges };
}

export function mapCriticChallenges(content: string, role: string, leadId: string): RunTrace["criticChallenges"] {
  const object = parseJsonObject(content);
  const array = parseJsonArray(content);
  const rawEntries = array.length ? array : Object.keys(object).length ? [object] : [];
  return rawEntries.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const entry = raw as Record<string, unknown>;
    const declaredLeadId = textValue(entry.leadId ?? entry.lead_id);
    if (declaredLeadId !== leadId) return [];
    const challenge = textValue(entry.challenge ?? entry.reason ?? entry.explanation);
    if (!challenge) return [];
    const disposition = textValue(entry.disposition).toLowerCase();
    return [{ role, leadId, challenge, disposition: disposition || undefined }];
  });
}

function summariseForModel(contracts: PricedContract[]): string { return JSON.stringify(contracts.slice(0, 12).map((contract) => ({ id: contract.evidenceId, publisher: contract.publisher, title: contract.title.slice(0, 100), date: contract.date, quantity: contract.quantity, value: contract.value, leaves: contract.leafCounts, unit: Number(contract.deflatedPricePerBook.toFixed(2)) }))); }
function leadForModel(lead: DeterministicLead, comparison?: LeafMatchedComparison): string { return JSON.stringify({ lead: { id: lead.id, kind: lead.kind, severity: lead.severity, title: lead.title, evidenceIds: lead.evidenceIds, arithmetic: lead.arithmetic, comparison: lead.comparison }, leafMatchedComparison: comparison ? { matchedLeafCounts: comparison.matchedLeafCounts, federalMedian: comparison.federalMedian, oyoMedian: comparison.oyoMedian, ratio: comparison.ratio } : null }); }

function requiredEvidence(lead: DeterministicLead): QueryToolName[] { return lead.kind === "twin-award" ? ["getFederalBookContractItems"] : ["getFederalBookContractItems", "searchOyoBookContracts", "getNigeriaCpi"]; }

function validateEvidence(leads: DeterministicLead[], selectedTools: QueryToolName[], trace: RunTrace): DeterministicLead[] {
  const available = new Set(selectedTools);
  const valid: DeterministicLead[] = [];
  for (const lead of leads) {
    const missing = requiredEvidence(lead).filter((tool) => !available.has(tool) && !(tool === "getFederalBookContractItems" && available.has("getLeafMatchedComparison")));
    if (missing.length > 0) {
      const reason = `Validation refused lead because evidence tools were not selected: ${missing.join(", ")}`;
      trace.validationFailures.push({ leadId: lead.id, missingTools: missing, reason });
      trace.withdrawnLeads.push({ leadId: lead.id, reason, severityBefore: lead.severity });
    } else valid.push(lead);
  }
  return valid;
}

function leadTag(leadId: string): string { return `lead:${leadId}`; }
function leadMemoryFor(hmem: HMEM, leadId: string): MemoryRecord | undefined { return hmem.store.all().filter((record) => record.tags.includes(leadTag(leadId))).sort((a, b) => a.id.localeCompare(b.id)).at(-1); }

function memoryState(trace: RunTrace, hmem: HMEM, leads: DeterministicLead[]): Map<string, { dismissed?: MemoryRecord }> {
  const state = new Map<string, { dismissed?: MemoryRecord }>();
  for (const lead of leads) {
    const records = hmem.store.all().filter((record) => record.tags.includes(leadTag(lead.id)));
    for (const record of records) trace.memoryReads.push({ leadId: lead.id, memoryId: record.id, supersededBy: record.supersededBy, content: record.content });
    const dismissal = records.find((record) => record.tags.includes("dismissal") && !record.supersededBy);
    if (dismissal) state.set(lead.id, { dismissed: dismissal });
    else if (records.length === 0) {
      const record = hmem.add({ content: `lead:${lead.id} ${lead.title}. ${lead.arithmetic}`, source: `contract-trail:lead:${lead.id}`, tags: [leadTag(lead.id), "lead"], type: "factual", confidence: 0.8 });
      trace.memoryWrites.push({ action: "create", leadId: lead.id, memoryId: record.id });
    }
  }
  return state;
}

export function dismissLead(leadId: string, reason: string, persistDir = HMEM_DIR, traceDir = resolve(ROOT, "runs"), memoryFile?: string): DismissalResult {
  const binding = memoryFile ? memoryBinding(memoryFile) : { persistDir, file: undefined };
  const hmem = new HMEM({ persistDir: binding.persistDir, actor: "contract-trail" });
  const previous = leadMemoryFor(hmem, leadId);
  if (!previous) throw new Error(`No stored lead memory found for ${leadId}. Run the investigation first.`);
  const memory = hmem.add({ content: `lead:${leadId} dismissed: ${reason}`, source: `contract-trail:dismissal:${leadId}`, tags: [leadTag(leadId), "dismissal"], type: "factual", confidence: 1, supersedes: previous.id, provenance: { origin: "user_correction", learnedAt: Date.now(), label: reason } });
  mkdirSync(traceDir, { recursive: true });
  const tracePath = resolve(traceDir, `${new Date().toISOString().replace(/[.:]/gu, "-")}-dismiss-${leadId.slice(0, 32)}.json`);
  writeFileSync(tracePath, `${JSON.stringify({ version: 2, mode: "LIVE", action: "dismiss", leadId, reason, previousMemoryId: previous.id, memoryId: memory.id, memoryWrites: [{ action: "create", memoryId: memory.id, supersedes: previous.id }] }, null, 2)}\n`, "utf8");
  syncMemoryFile(binding);
  return { leadId, reason, previousMemoryId: previous.id, memory, tracePath };
}

function newTrace(question: string): RunTrace { return { version: 2, mode: "LIVE", question, startedAt: new Date().toISOString(), plan: null, plannerChosenTools: [], selectedTools: [], toolSelectionNotes: [], toolCalls: [], modelCalls: [], modelOutputs: {}, criticChallenges: [], criticRequests: [], dispositionChanges: [], validationFailures: [], withdrawnLeads: [], supersededLeads: [], finalLeads: [], supplierContext: [], memoryReads: [], memoryWrites: [] }; }

async function runTool(trace: RunTrace, tool: QueryToolName, params: Record<string, unknown>, requestedBy: ToolTrace["requestedBy"], onEvent?: (event: TraceEvent) => void): Promise<unknown[][]> {
  const query = buildTypedQuery(tool);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const result = await runZetarisSql(query.sql, query.limit);
    const resultRows = rows(result);
    const toolTrace = { tool, params, sql: query.sql, limit: query.limit, startedAt, durationMs: Date.now() - started, rowCount: resultRows.length, resultRows: resultRows.slice(0, 200), status: "ok" as const, requestedBy };
    trace.toolCalls.push(toolTrace);
    onEvent?.({ type: "tool_call", data: toolTrace });
    return resultRows;
  } catch (error) {
    const toolTrace = { tool, params, sql: query.sql, limit: query.limit, startedAt, durationMs: Date.now() - started, rowCount: 0, resultRows: [], status: "error" as const, requestedBy, error: error instanceof Error ? error.message : String(error) };
    trace.toolCalls.push(toolTrace);
    onEvent?.({ type: "tool_call", data: toolTrace });
    throw error;
  }
}

async function defenceCall(trace: RunTrace, question: string, lead: DeterministicLead, federal: PricedContract[], oyo: PricedContract[], comparison: LeafMatchedComparison | undefined, rejudge: boolean, onEvent?: (event: TraceEvent) => void): Promise<{ decisions: LeadDisposition[]; requests: CriticRequestTrace[] }> {
  const ids = [lead.id];
  const result = await callAndRecord(trace, { role: "defence-critic", model: deepModel(), fallbackModel: fastModel(), maxTokens: 4096, chatTemplateKwargs: THINKING_OFF, messages: [
    { role: "system", content: `You are the defence critic. detailed thinking off. ${rejudge ? "Re-judge after the requested typed-tool result." : "Review this deterministic lead."} Return a JSON array with one object containing leadId, disposition (stand, downgrade, or withdraw), reason. If this price-gap lead lacks a leaf-matched comparison, request it with needs: {tool:"getLeafMatchedComparison",params:{leafCounts:[20,40,60,80,100]}}. If a lead is explained by duplicate release or invalid evidence, withdraw it. Otherwise downgrade when specifications, distribution, or lot scale remain unresolved. Do not calculate numbers.` },
    { role: "user", content: `Question: ${question}\n${leadForModel(lead, comparison)}\nFederal evidence: ${summariseForModel(federal)}\nOyo evidence: ${summariseForModel(oyo)}` },
  ] });
  const parsed = parseCriticEntries(result.content, ids);
  trace.criticChallenges.push(...parsed.challenges);
  for (const challenge of parsed.challenges) onEvent?.({ type: "critic_challenge", data: challenge });
  const hasLeafComparison = Boolean(comparison?.matchedLeafCounts.length);
  const criticAskedForLeaves = parsed.requests.some((request) => request.tool === "getLeafMatchedComparison");
  if (lead.kind === "price-gap" && !hasLeafComparison && !criticAskedForLeaves) {
    const requiredRequest: CriticRequestTrace = {
      leadId: lead.id,
      tool: "getLeafMatchedComparison",
      params: { leafCounts: [20, 40, 60, 80, 100] },
      round: 0,
      status: "executed",
      reason: "defence evidence gate: unmatched leaf counts require a leaf-matched comparison",
    };
    parsed.requests.push(requiredRequest);
  }
  return { ...parsed, requests: parsed.requests.map((request) => ({ ...request, leadId: request.leadId ?? lead.id })) };
}

export function shouldRunCriticTool(requests: CriticRequestTrace[], tool: QueryToolName): boolean {
  return requests.some((request) => request.tool === tool && request.status === "executed");
}

function recompute(federalRows: unknown[][], oyoRows: unknown[][], cpiRows: unknown[][], leafRows: unknown[][] | undefined, trace: RunTrace): { federal: PricedContract[]; oyo: PricedContract[]; comparison?: LeafMatchedComparison; leads: DeterministicLead[] } {
  const federalItems = federalRows.map(asFederalItem);
  const oyoContracts = oyoRows.map(asOyoContract);
  const cpi = cpiRows.map(asCpiPoint);
  const federal = federalItemsToPriced(federalItems, cpi);
  const oyo = oyoToPriced(oyoContracts, cpi);
  const comparison = leafRows ? buildLeafMatchedComparison(federalToLeafPrices(leafRows.map(asFederalItem), cpi), oyoToLeafPrices(oyoContracts, cpi), cpi.length ? Math.max(...cpi.map((point) => point.year)) : 0) : undefined;
  if (comparison) trace.leafMatchedComparison = comparison;
  return { federal, oyo, comparison, leads: buildDeterministicLeads(federal, oyo, comparison) };
}

function saveTrace(trace: RunTrace, slug: string): string { mkdirSync(resolve(ROOT, "runs"), { recursive: true }); const path = resolve(ROOT, "runs", `${new Date().toISOString().replace(/[.:]/gu, "-")}-${slug}.json`); writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`, "utf8"); return path; }

export async function runContractTrail(question = DEFAULT_QUESTION, options: RunOptions = {}): Promise<RunResult> {
  const trace = newTrace(question);
  const started = Date.now();
  let tracePath = "";
  const memory = memoryBinding(options.memoryFile);
  const emit = options.onEvent;
  try {
    const planner = await callAndRecord(trace, { role: "planner", model: deepModel(), fallbackModel: fastModel(), maxTokens: 4096, chatTemplateKwargs: THINKING_OFF, messages: [
      { role: "system", content: "You are the Contract Trail planner. detailed thinking off. Do not compute numbers or decide matches. Return JSON with steps and a tools array containing only typed tool names needed for the question." },
      { role: "user", content: `Question: ${question}\nTools: ${toolNameList().join(", ")}\nPlan federal/Oyo price comparison, CPI, and twin-award check. A leaf-matched follow-up is critic-only.` },
    ] }, emit);
    trace.plan = parseJsonObject(planner.content);
    if (Object.keys(trace.plan as Record<string, unknown>).length === 0) trace.plan = planFallback();
    trace.plannerChosenTools = selectedToolsFrom(planner.content);
    trace.toolSelectionNotes.push(`planner chose ${trace.plannerChosenTools.join(", ") || "no tools"}`);
    emit?.({ type: "plan", data: trace.plan });

    const dataAgent = await callAndRecord(trace, { role: "data-agent", model: fastModel(), maxTokens: 4096, chatTemplateKwargs: THINKING_OFF, messages: [
      { role: "system", content: "You are a typed-tool data agent. detailed thinking off. Select named tools only. Never emit SQL, calculate numbers, or silently add tools." },
      { role: "user", content: buildToolSelectionPrompt(question, JSON.stringify(trace.plan)) },
    ] }, emit);
    trace.selectedTools = selectedToolsFrom(dataAgent.content);
    trace.toolSelectionNotes.push(`data-agent chose ${trace.selectedTools.join(", ") || "no tools"}`);
    const plannerSet = new Set(trace.plannerChosenTools);
    for (const tool of trace.selectedTools.filter((value) => !plannerSet.has(value))) trace.toolSelectionNotes.push(`data-agent added ${tool}`);

    const toolRows = new Map<QueryToolName, unknown[][]>();
    for (const tool of trace.selectedTools) {
      if (tool === "getLeafMatchedComparison") {
        trace.toolSelectionNotes.push("getLeafMatchedComparison deferred until a defence critic request");
        continue;
      }
      toolRows.set(tool, await runTool(trace, tool, {}, "data-agent", emit));
    }
    const federalContractRows = toolRows.get("searchFederalBookContracts") ?? [];
    const federalRows = toolRows.get("getFederalBookContractItems") ?? toolRows.get("getLeafMatchedComparison") ?? [];
    const oyoRows = toolRows.get("searchOyoBookContracts") ?? [];
    const cpiRows = toolRows.get("getNigeriaCpi") ?? [];
    trace.supplierContext = (toolRows.get("getCrossPublisherSuppliers") ?? []).map((row) => ({ supplier: normaliseSupplierName(textValue(row[0])), bppAwards: numberValue(row[1]), osunAwards: numberValue(row[2]) }));
    const initial = recompute(federalRows, oyoRows, cpiRows, toolRows.get("getLeafMatchedComparison"), trace);
    let candidates = validateEvidence(initial.leads, trace.selectedTools, trace);
    if (candidates.length === 0) throw new Error("deterministic validation refused every lead because required evidence tools were not selected");

    await Promise.all(candidates.map(async (lead) => {
      const result = await callAndRecord(trace, { role: "classifier-critic", model: fastModel(), maxTokens: 4096, chatTemplateKwargs: THINKING_OFF, messages: [
        { role: "system", content: "You are a classifier critic. detailed thinking off. Return a JSON array of challenges for this lead. Exclude laptop or ThinkPad notebook matches and mixed-item contracts. Do not calculate or change numbers." },
        { role: "user", content: `Question: ${question}\nFederal rows: ${federalContractRows.length}\nEvidence: ${summariseForModel(initial.federal)}\nOyo: ${summariseForModel(initial.oyo)}\nLead: ${leadForModel(lead, initial.comparison)}` },
      ] }, emit);
      const entries = mapCriticChallenges(result.content, "classifier-critic", lead.id);
      trace.criticChallenges.push(...entries);
      for (const challenge of entries) emit?.({ type: "critic_challenge", data: challenge });
    }));

    const initialDefence = await Promise.all(candidates.map((lead) => defenceCall(trace, question, lead, initial.federal, initial.oyo, initial.comparison, false, emit)));
    const decisions = new Map<string, LeadDisposition>();
    let pendingRequests: CriticRequestTrace[] = [];
    for (const result of initialDefence) {
      for (const decision of result.decisions) decisions.set(decision.leadId, decision);
      pendingRequests.push(...result.requests);
    }

    let leafRows = toolRows.get("getLeafMatchedComparison");
    const requestCounts = new Map<string, number>();
    for (let round = 1; round <= 2; round += 1) {
      const requests = pendingRequests.filter((request) => {
        const leadKey = request.leadId ?? "all";
        const count = requestCounts.get(leadKey) ?? 0;
        if (count >= 2) {
          const bounded = { ...request, round, status: "bounded" as const, reason: "maximum two critic-to-data rounds per lead reached" };
          trace.criticRequests.push(bounded);
          emit?.({ type: "critic_request", data: bounded });
          return false;
        }
        requestCounts.set(leadKey, count + 1);
        return true;
      });
      if (requests.length === 0) break;
      const rejudgeIds = new Set<string>();
      for (const request of requests) {
        if (request.tool !== "getLeafMatchedComparison") {
          const rejected = { ...request, round, status: "rejected" as const, reason: "tool is typed but not implemented for this replayable case" };
          trace.criticRequests.push(rejected);
          emit?.({ type: "critic_request", data: rejected });
          continue;
        }
        const executed = { ...request, round, status: "executed" as const };
        trace.criticRequests.push(executed);
        emit?.({ type: "critic_request", data: executed });
        if (!shouldRunCriticTool([executed], "getLeafMatchedComparison")) continue;
        leafRows = await runTool(trace, request.tool, request.params, "critic", emit);
        if (request.leadId) rejudgeIds.add(request.leadId);
      }
      if (rejudgeIds.size === 0) break;
      const updated = recompute(federalRows, oyoRows, cpiRows, leafRows, trace);
      candidates = validateEvidence(updated.leads, trace.selectedTools.concat("getLeafMatchedComparison"), trace);
      const rejudged = await Promise.all(candidates.filter((lead) => rejudgeIds.has(lead.id)).map((lead) => defenceCall(trace, question, lead, updated.federal, updated.oyo, updated.comparison, true, emit)));
      pendingRequests = [];
      for (const result of rejudged) {
        for (const decision of result.decisions) decisions.set(decision.leadId, decision);
        pendingRequests.push(...result.requests);
      }
    }

    const finalData = recompute(federalRows, oyoRows, cpiRows, leafRows, trace);
    candidates = validateEvidence(finalData.leads, trace.selectedTools.concat(leafRows ? ["getLeafMatchedComparison"] : []), trace);
    const applied = applyLeadDispositions(candidates, [...decisions.values()]);
    for (const change of applied.changes) {
      trace.dispositionChanges.push(change);
      emit?.({ type: "disposition", data: change });
    }
    for (const item of applied.withdrawn) trace.withdrawnLeads.push({ leadId: item.lead.id, reason: item.reason, severityBefore: item.lead.severity });

    const hmem = new HMEM({ persistDir: memory.persistDir, actor: "contract-trail" });
    const memories = memoryState(trace, hmem, finalData.leads);
    const superseded = new Set<string>();
    for (const [leadId, state] of memories) if (state.dismissed) {
      superseded.add(leadId);
      trace.supersededLeads.push({ leadId, memoryId: state.dismissed.id, reason: state.dismissed.content.replace(/^.*dismissed:\s*/u, "") });
    }
    const finalLeads = applied.active.filter((lead) => !superseded.has(lead.id));
    const reporter = await callAndRecord(trace, { role: "reporter", model: fastModel(), maxTokens: 4096, chatTemplateKwargs: THINKING_OFF, messages: [
      { role: "system", content: "You are the Contract Trail reporter. detailed thinking off. Return JSON only. Use this deterministic summary and call findings leads to verify, never accusations." },
      { role: "user", content: `Question: ${question}\nFinal leads: ${JSON.stringify(finalLeads)}\nWithdrawn: ${JSON.stringify(trace.withdrawnLeads)}\nSuperseded: ${JSON.stringify(trace.supersededLeads)}\nChanges: ${JSON.stringify(trace.dispositionChanges)}\nChallenges: ${JSON.stringify(trace.criticChallenges.slice(-12))}\nLeaf ratio: ${trace.leafMatchedComparison?.ratio ?? null}` },
    ] });
    if (!reporter.content.trim()) throw new Error("reporter returned no model content");
    trace.reporterOutput = reporter.content;
    trace.reporterModel = reporter.returnedModel;
    trace.finalLeads = finalLeads;
    syncMemoryFile(memory);
    trace.totalRunMs = Date.now() - started;
    tracePath = saveTrace(trace, question.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "question");
    return { trace, tracePath, leads: finalLeads, withdrawnLeads: trace.withdrawnLeads, supersededLeads: trace.supersededLeads };
  } catch (error) {
    trace.totalRunMs = Date.now() - started;
    syncMemoryFile(memory);
    if (!tracePath) saveTrace(trace, `${question.toLowerCase().replace(/[^a-z0-9]+/gu, "-").slice(0, 48) || "question"}-failed`);
    throw error;
  }
}
