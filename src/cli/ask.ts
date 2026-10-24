import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { runZetarisSql, rows } from "../../scripts/zetaris/client.js";
import { buildTypedQuery, buildToolSelectionPrompt, isKnownQueryTool, toolNameList, type QueryToolName } from "../data/queries.js";
import { callNightshift, deepModel, fastModel, parseJsonArray, parseJsonObject, type ModelCallLog, type ModelCallResult } from "../llm/nightshift.js";
import {
  buildDeterministicLeads,
  federalItemsToPriced,
  numberValue,
  oyoToPriced,
  normaliseSupplierName,
  textValue,
  yearOf,
  type CpiPoint,
  type FederalContract,
  type FederalItem,
  type OyoContract,
  type PricedContract,
} from "../rules/procurement.js";

dotenv.config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

type ToolTrace = {
  tool: QueryToolName;
  sql: string;
  limit: number;
  startedAt: string;
  durationMs: number;
  rowCount: number;
  status: "ok" | "error";
  error?: string;
};

type TracedModelCall = ModelCallLog & { output?: string };

type RunTrace = {
  version: 1;
  mode: "LIVE";
  question: string;
  startedAt: string;
  plan: unknown;
  selectedTools: QueryToolName[];
  toolCalls: ToolTrace[];
  modelCalls: TracedModelCall[];
  modelOutputs: Record<string, string>;
  criticChallenges: Array<{ role: string; leadId?: string; challenge: string; disposition?: string }>;
  withdrawnLeads: Array<{ leadId: string; reason: string }>;
  finalLeads: unknown[];
  supplierContext: Array<{ supplier: string; bppAwards: number; osunAwards: number }>;
  memoryReads: unknown[];
  memoryWrites: unknown[];
  totalRunMs?: number;
};

function questionFromArgs(): string {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) throw new Error('usage: npm run ask -- "<question>"');
  return question;
}

function asFederalContract(row: unknown[]): FederalContract {
  return {
    id: textValue(row[0]),
    mainOcid: textValue(row[1]),
    mainId: textValue(row[2]),
    title: textValue(row[3]),
    dateSigned: textValue(row[4]),
    value: numberValue(row[5]),
    currency: textValue(row[6]),
  };
}

function asFederalItem(row: unknown[]): FederalItem {
  return {
    contractId: textValue(row[0]),
    mainOcid: textValue(row[1]),
    mainId: textValue(row[2]),
    title: textValue(row[3]),
    dateSigned: textValue(row[4]),
    value: numberValue(row[5]),
    currency: textValue(row[6]),
    itemId: textValue(row[7]),
    quantity: numberValue(row[8]),
    description: textValue(row[9]),
  };
}

function asOyoContract(row: unknown[]): OyoContract {
  return {
    ocid: textValue(row[0]),
    id: textValue(row[1]),
    date: textValue(row[2]),
    title: textValue(row[3]),
    value: numberValue(row[4]),
    currency: textValue(row[5]),
    buyer: textValue(row[6]),
    procuringEntity: textValue(row[7]),
  };
}

function asCpiPoint(row: unknown[]): CpiPoint {
  return { year: yearOf(textValue(row[0])), value: numberValue(row[1]) };
}

async function runTool(trace: RunTrace, tool: QueryToolName): Promise<unknown[][]> {
  const query = buildTypedQuery(tool);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const result = await runZetarisSql(query.sql, query.limit);
    const resultRows = rows(result);
    trace.toolCalls.push({ tool, sql: query.sql, limit: query.limit, startedAt, durationMs: Date.now() - started, rowCount: resultRows.length, status: "ok" });
    return resultRows;
  } catch (error) {
    trace.toolCalls.push({ tool, sql: query.sql, limit: query.limit, startedAt, durationMs: Date.now() - started, rowCount: 0, status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function addModelLogs(trace: RunTrace, logs: ModelCallLog[], output: string, role: string): void {
  for (const log of logs) trace.modelCalls.push({ ...log, output: log.role === role ? output : undefined });
  trace.modelOutputs[role] = output;
}

async function callAndRecord(
  trace: RunTrace,
  options: Parameters<typeof callNightshift>[0],
): Promise<ModelCallResult> {
  try {
    const result = await callNightshift(options);
    addModelLogs(trace, result.logs, result.content, options.role);
    return result;
  } catch (error) {
    const failed = error as Error & { modelLogs?: ModelCallLog[]; callLog?: ModelCallLog };
    const logs = failed.modelLogs ?? (failed.callLog ? [failed.callLog] : []);
    if (logs.length > 0) {
      for (const log of logs) trace.modelCalls.push({ ...log, output: undefined });
    }
    trace.modelOutputs[options.role] = `ERROR: ${failed.message}`;
    return { content: "", returnedModel: null, logs };
  }
}

function planFallback(): Record<string, unknown> {
  return {
    steps: [
      "Find federal exercise-book and notebook contracts.",
      "Get contract item quantities and descriptions.",
      "Find Oyo exercise-book titles and parse their quantities.",
      "Deflate deterministic per-book prices with Nigeria CPI.",
      "Check the twin-award rule and ask critics to challenge each lead.",
    ],
  };
}

function selectedToolsFrom(content: string): QueryToolName[] {
  const parsed = parseJsonObject(content).tools;
  if (!Array.isArray(parsed)) return toolNameList();
  const selected = parsed.filter(isKnownQueryTool);
  return selected.length > 0 ? [...new Set(selected)] : toolNameList();
}

function challengeRows(content: string, role: string, leadIds: string[]): Array<{ role: string; leadId?: string; challenge: string; disposition?: string }> {
  const parsed = parseJsonArray(content);
  const result: Array<{ role: string; leadId?: string; challenge: string; disposition?: string }> = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const object = entry as Record<string, unknown>;
    const challenge = textValue(object.challenge ?? object.reason ?? object.explanation);
    if (!challenge) continue;
    const leadId = textValue(object.leadId ?? object.lead_id);
    result.push({ role, leadId: leadIds.includes(leadId) ? leadId : undefined, challenge, disposition: textValue(object.disposition) || undefined });
  }
  if (result.length === 0 && content.trim()) result.push({ role, challenge: content.trim().slice(0, 1_000) });
  return result;
}

function summariseForModel(contracts: PricedContract[]): string {
  return JSON.stringify(contracts.slice(0, 30).map((contract) => ({
    evidenceId: contract.evidenceId,
    publisher: contract.publisher,
    title: contract.title,
    date: contract.date,
    quantity: contract.quantity,
    value: contract.value,
    nominalPricePerBook: Number(contract.nominalPricePerBook.toFixed(2)),
    deflatedPricePerBook: Number(contract.deflatedPricePerBook.toFixed(2)),
    details: contract.details,
  })));
}

async function main(): Promise<void> {
  const question = questionFromArgs();
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const trace: RunTrace = {
    version: 1,
    mode: "LIVE",
    question,
    startedAt,
    plan: null,
    selectedTools: [],
    toolCalls: [],
    modelCalls: [],
    modelOutputs: {},
    criticChallenges: [],
    withdrawnLeads: [],
    finalLeads: [],
    supplierContext: [],
    memoryReads: [],
    memoryWrites: [],
  };
  let tracePath = "";
  try {
    const planner = await callAndRecord(trace, {
      role: "planner",
      model: deepModel(),
      fallbackModel: fastModel(),
      maxTokens: 4096,
      messages: [
        { role: "system", content: "You are the Contract Trail planner. Do not compute numbers or decide matches. Return a concise JSON plan for typed tools and deterministic rules." },
        { role: "user", content: `Question: ${question}\nReturn JSON with steps and the data needed for price per book, CPI deflation, dedupe, and twin awards.` },
      ],
    });
    trace.plan = parseJsonObject(planner.content);
    if (Object.keys(trace.plan as Record<string, unknown>).length === 0) trace.plan = planFallback();

    const dataAgent = await callAndRecord(trace, {
      role: "data-agent",
      model: fastModel(),
      maxTokens: 2048,
      messages: [
        { role: "system", content: "You are a typed-tool data agent. You may select named tools only. Never emit SQL, compute prices, or infer matches." },
        { role: "user", content: buildToolSelectionPrompt(question, JSON.stringify(trace.plan)) },
      ],
    });
    trace.selectedTools = selectedToolsFrom(dataAgent.content);
    const requiredTools = toolNameList();
    const toolSet = new Set([...trace.selectedTools, ...requiredTools]);
    trace.selectedTools = requiredTools.filter((tool) => toolSet.has(tool));

    const toolRows = new Map<QueryToolName, unknown[][]>();
    for (const tool of trace.selectedTools) toolRows.set(tool, await runTool(trace, tool));
    const federalContracts = (toolRows.get("searchFederalBookContracts") ?? []).map(asFederalContract);
    const federalItems = (toolRows.get("getFederalBookContractItems") ?? []).map(asFederalItem);
    const oyoContracts = (toolRows.get("searchOyoBookContracts") ?? []).map(asOyoContract);
    const cpi = (toolRows.get("getNigeriaCpi") ?? []).map(asCpiPoint);
    trace.supplierContext = (toolRows.get("getCrossPublisherSuppliers") ?? []).map((row) => ({
      supplier: normaliseSupplierName(textValue(row[0])),
      bppAwards: numberValue(row[1]),
      osunAwards: numberValue(row[2]),
    }));
    const federal = federalItemsToPriced(federalItems, cpi);
    const oyo = oyoToPriced(oyoContracts, cpi);
    const leads = buildDeterministicLeads(federal, oyo);
    const leadIds = leads.map((lead) => lead.id);

    const classifier = await callAndRecord(trace, {
      role: "classifier-critic",
      model: fastModel(),
      maxTokens: 2048,
      messages: [
        { role: "system", content: "You are a classifier critic. Exclude laptop or ThinkPad notebook matches and mixed-item contracts from per-book evidence. Do not calculate or change numbers. Return a JSON array of objects with leadId, challenge, disposition." },
        { role: "user", content: `Question: ${question}\nFederal contracts found: ${federalContracts.length}\nBook-only priced contracts: ${summariseForModel(federal)}\nOyo priced contracts: ${summariseForModel(oyo)}\nLeads: ${JSON.stringify(leads)}` },
      ],
    });
    trace.criticChallenges.push(...challengeRows(classifier.content, "classifier-critic", leadIds));

    const defence = await callAndRecord(trace, {
      role: "defence-critic",
      model: deepModel(),
      fallbackModel: fastModel(),
      maxTokens: 4096,
      messages: [
        { role: "system", content: "You are the defence critic. For every lead, propose an innocent explanation such as inflation, specifications, distribution, separate lots, or duplicate release. Do not recompute numbers. Return a JSON array with leadId, challenge, disposition where disposition is stand, downgrade, or withdraw." },
        { role: "user", content: `Question: ${question}\nDeterministic leads and arithmetic: ${JSON.stringify(leads)}\nUnderlying federal evidence: ${summariseForModel(federal)}\nUnderlying Oyo evidence: ${summariseForModel(oyo)}` },
      ],
    });
    trace.criticChallenges.push(...challengeRows(defence.content, "defence-critic", leadIds));
    if (trace.criticChallenges.length === 0) {
      trace.criticChallenges.push({ role: "defence-critic", challenge: "Verify that book specifications, delivery, and lot boundaries are comparable before treating the deterministic result as a lead." });
    }

    const reporter = await callAndRecord(trace, {
      role: "reporter",
      model: fastModel(),
      maxTokens: 2048,
      messages: [
        { role: "system", content: "You are the Contract Trail reporter. Use the deterministic lead list and critic challenges. Return JSON only with a short disclaimer and leadIds. Call them leads to verify, never accusations." },
        { role: "user", content: `Question: ${question}\nLeads: ${JSON.stringify(leads)}\nCritic challenges: ${JSON.stringify(trace.criticChallenges)}` },
      ],
    });
    trace.finalLeads = leads;
    if (leads.length === 0) throw new Error("deterministic engine produced no leads from live data");

    trace.totalRunMs = Date.now() - started;
    mkdirSync(resolve(ROOT, "runs"), { recursive: true });
    const slug = question.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "question";
    tracePath = resolve(ROOT, "runs", `${new Date().toISOString().replace(/[.:]/gu, "-")}-${slug}.json`);
    writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");

    console.log(`[ask] mode=${trace.mode}`);
    console.log(`[ask] question=${question}`);
    console.log(`[ask] lead list (${leads.length})`);
    for (const lead of leads) {
      console.log(`[ask] lead=${lead.id} severity=${lead.severity} title=${lead.title}`);
      console.log(`[ask] evidence=${lead.evidenceIds.join(", ")}`);
      console.log(`[ask] arithmetic=${lead.arithmetic}`);
    }
    console.log(`[ask] critic challenge=${trace.criticChallenges[0].challenge}`);
    console.log(`[ask] trace=${tracePath}`);
    console.log(`[ask] total_run_ms=${trace.totalRunMs}`);
    console.log(`[ask] supplier_context=${trace.supplierContext.length} cross-publisher suppliers`);
    console.log("[ask] model_ids");
    for (const call of trace.modelCalls) console.log(`[ask] ${call.role} requested=${call.requestedModel} returned=${call.returnedModel ?? "unknown"} status=${call.status}`);
  } finally {
    if (!tracePath) {
      trace.totalRunMs = Date.now() - started;
      mkdirSync(resolve(ROOT, "runs"), { recursive: true });
      const slug = question.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "question";
      const failurePath = resolve(ROOT, "runs", `${new Date().toISOString().replace(/[.:]/gu, "-")}-${slug}-failed.json`);
      writeFileSync(failurePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
    }
  }
}

main().catch((error: unknown) => {
  console.error(`[ask] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
