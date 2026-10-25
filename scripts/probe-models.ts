import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { deepModel, fastModel, probeModelCall, type ModelCallLog } from "../src/llm/nightshift.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
dotenv.config({ path: resolve(root, ".env") });

type Role = "planner" | "data-agent" | "classifier-critic" | "defence-critic" | "reporter";
type Variant = { name: string; maxTokens: number; thinkingOff: boolean };

const roles: Array<{ role: Role; model: string; prompt: string }> = [
  { role: "planner", model: deepModel(), prompt: "Return JSON {\"tools\":[\"getNigeriaCpi\"],\"steps\":[\"compare\"]}. Do not compute." },
  { role: "data-agent", model: fastModel(), prompt: "Return JSON {\"tools\":[\"getFederalBookContractItems\"]}. Choose typed tools only." },
  { role: "classifier-critic", model: fastModel(), prompt: "Return JSON [{\"leadId\":\"price-gap\",\"challenge\":\"verify leaves\"}]. Do not compute." },
  { role: "defence-critic", model: deepModel(), prompt: "Return JSON [{\"leadId\":\"price-gap\",\"disposition\":\"stand\",\"reason\":\"evidence is present\"}]. Do not compute." },
  { role: "reporter", model: fastModel(), prompt: "Return JSON {\"summary\":\"one lead to verify\",\"leadIds\":[\"price-gap\"]}." },
];

const variants: Variant[] = [
  { name: "4096-default", maxTokens: 4096, thinkingOff: false },
  { name: "8192-default", maxTokens: 8192, thinkingOff: false },
  { name: "4096-thinking-off", maxTokens: 4096, thinkingOff: true },
  { name: "8192-thinking-off", maxTokens: 8192, thinkingOff: true },
];

const repetitions = Number(process.env.PROBE_REPETITIONS ?? 10);
const concurrency = Math.max(1, Number(process.env.PROBE_CONCURRENCY ?? 10));

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<ModelCallLog>): Promise<ModelCallLog[]> {
  const output: ModelCallLog[] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(...await Promise.all(items.slice(index, index + size).map(fn)));
  }
  return output;
}

function summary(role: Role, variant: Variant, model: string, logs: ModelCallLog[]): Record<string, unknown> {
  const numbers = (values: Array<number | undefined>): number[] => values.filter((value): value is number => value !== undefined);
  const latencies = numbers(logs.map((log) => log.latencyMs));
  const tokens = numbers(logs.map((log) => log.tokens));
  const reasoning = numbers(logs.map((log) => log.reasoningTokens));
  const finishReasons = [...new Set(logs.map((log) => log.finishReason ?? "none"))].join(",");
  return {
    role,
    variant: variant.name,
    model,
    calls: logs.length,
    empty: logs.filter((log) => (log.contentLength ?? 0) === 0).length,
    reasoningContentOnlyDefects: logs.filter((log) => log.modelDefect === "content_empty_reasoning_present").length,
    errors: logs.filter((log) => log.status === "error").length,
    avgLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length)),
    avgTokens: tokens.length ? Math.round(tokens.reduce((sum, value) => sum + value, 0) / tokens.length) : null,
    avgReasoningTokens: reasoning.length ? Math.round(reasoning.reduce((sum, value) => sum + value, 0) / reasoning.length) : null,
    avgContentLength: Math.round(numbers(logs.map((log) => log.contentLength)).reduce((sum, value) => sum + value, 0) / Math.max(1, logs.length)),
    finishReasons,
  };
}

async function main(): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const raw: Array<{ role: Role; variant: string; logs: ModelCallLog[] }> = [];
  for (const variant of variants) {
    for (const entry of roles) {
      const messages = [{ role: "system" as const, content: variant.thinkingOff ? "detailed thinking off. Return only the requested JSON." : "Return only the requested JSON." }, { role: "user" as const, content: entry.prompt }];
      const requests = Array.from({ length: repetitions }, () => ({ role: entry.role, model: entry.model, messages, maxTokens: variant.maxTokens, timeoutMs: 60_000, ...(variant.thinkingOff ? { chatTemplateKwargs: { enable_thinking: false } } : {}) }));
      const logs = await inBatches(requests, concurrency, (request) => probeModelCall(request));
      rows.push(summary(entry.role, variant, entry.model, logs));
      raw.push({ role: entry.role, variant: variant.name, logs });
      console.log(`[probe] ${variant.name} ${entry.role} empty=${logs.filter((log) => (log.contentLength ?? 0) === 0).length}/${logs.length}`);
    }
  }
  const outDir = resolve(root, "runs");
  mkdirSync(outDir, { recursive: true });
  const outputPath = resolve(outDir, `probe-models-${new Date().toISOString().replace(/[.:]/gu, "-")}.json`);
  writeFileSync(outputPath, `${JSON.stringify({ rows, raw }, null, 2)}\n`, "utf8");
  console.table(rows);
  console.log(`[probe] trace=${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(`[probe] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
