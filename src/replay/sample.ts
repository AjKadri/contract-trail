import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeterministicLead } from "../rules/procurement.js";
import type { RunResult, RunTrace, TraceEvent } from "../agents/contractTrail.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_REPLAY_FILENAME = "2026-10-25T13-55-53-386Z-are-the-exercise-book-contracts-in-federal-const.json";
export const TRACE_LABELS: Record<string, string> = {
  [DEFAULT_REPLAY_FILENAME]: "first run: price gap + twin award",
  "2026-10-25T14-10-37-293Z-are-the-exercise-book-contracts-in-federal-const.json": "memory: twin superseded",
  "2026-10-26T20-02-52-561Z-which-suppliers-won-contracts-from-both-the-fede.json": "cross-publisher suppliers",
  "2026-10-26T20-03-21-074Z-are-any-federal-exercise-book-awards-suspiciousl.json": "similar federal awards",
};

export function findRecordedTrace(runsDir = join(ROOT, "runs")): string {
  const preferred = join(runsDir, DEFAULT_REPLAY_FILENAME);
  if (existsSync(preferred)) return preferred;
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
