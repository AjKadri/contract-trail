import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeterministicLead } from "../rules/procurement.js";
import type { RunResult, RunTrace, TraceEvent } from "../agents/contractTrail.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function findRecordedTrace(runsDir = join(ROOT, "runs")): string {
  const candidates = readdirSync(runsDir)
    .filter((file) => file.endsWith(".json") && file.includes("-are-the-exercise-book-contracts-in-federal-const"))
    .filter((file) => !file.startsWith("probe-"))
    .sort();
  const trace = candidates.at(-1);
  if (!trace) throw new Error(`No recorded replay trace found in ${runsDir}`);
  return join(runsDir, trace);
}

export function loadRecordedTrace(tracePath = findRecordedTrace()): RunResult {
  if (!existsSync(tracePath)) throw new Error(`Replay trace does not exist: ${tracePath}`);
  const source = JSON.parse(readFileSync(tracePath, "utf8")) as RunTrace;
  const trace: RunTrace = { ...source, mode: "REPLAYED" };
  return {
    trace,
    tracePath,
    leads: (trace.finalLeads ?? []) as DeterministicLead[],
    withdrawnLeads: trace.withdrawnLeads ?? [],
    supersededLeads: trace.supersededLeads ?? [],
  };
}

export function replayEvents(trace: RunTrace): TraceEvent[] {
  return [
    ...(trace.plan ? [{ type: "plan" as const, data: trace.plan }] : []),
    ...trace.modelCalls.map((data) => ({ type: "model_call" as const, data })),
    ...trace.toolCalls.map((data) => ({ type: "tool_call" as const, data })),
    ...trace.criticChallenges.map((data) => ({ type: "critic_challenge" as const, data })),
    ...trace.criticRequests.map((data) => ({ type: "critic_request" as const, data })),
    ...trace.dispositionChanges.map((data) => ({ type: "disposition" as const, data })),
  ];
}
