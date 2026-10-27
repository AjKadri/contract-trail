import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_REPLAY_FILENAME, TRACE_LABELS } from "../src/replay/sample.js";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const sourceDir = join(ROOT, "docs", "viewer-src");
const outputDir = join(ROOT, "docs", "viewer");
const traceOutputDir = join(outputDir, "traces");
const runsDir = join(ROOT, "runs");

type RecordedTrace = {
  startedAt?: unknown;
  totalRunMs?: unknown;
  finalLeads?: unknown;
};

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(traceOutputDir, { recursive: true });
for (const file of ["index.html", "viewer.js", "viewer.css", "favicon.svg"]) copyFileSync(join(sourceDir, file), join(outputDir, file));

const curatedNames = [...readFileSync(join(runsDir, "README.md"), "utf8").matchAll(/^- `([^`]+\.json)`(?:[ \t]+.*)?$/gmu)].map((match) => match[1]);
const available = new Set(readdirSync(runsDir));
const traces = (curatedNames.length > 0 ? curatedNames.filter((file) => available.has(file)) : [...available].filter((file) => file.endsWith(".json")).sort())
  .filter((file) => file.endsWith(".json"))
  .filter((file) => !file.startsWith("probe-") && !file.includes("-dismiss-"));
const defaultSample = traces.includes(DEFAULT_REPLAY_FILENAME) ? DEFAULT_REPLAY_FILENAME : traces.at(-1);
if (!defaultSample) throw new Error("No real investigation traces found under runs/");

const catalog = traces.map((file) => {
  const trace = JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RecordedTrace;
  const startedAt = typeof trace.startedAt === "string" ? trace.startedAt : "";
  const durationMs = typeof trace.totalRunMs === "number" ? trace.totalRunMs : null;
  const leads = Array.isArray(trace.finalLeads) ? trace.finalLeads.length : 0;
  copyFileSync(join(runsDir, file), join(traceOutputDir, file));
  return {
    file,
    label: TRACE_LABELS[file] ?? `${startedAt.slice(0, 10)} ${startedAt.slice(11, 19)} UTC · ${durationMs == null ? "recorded" : `${(durationMs / 1000).toFixed(1)} s`} · ${leads} leads`,
    date: startedAt.slice(0, 10),
    time: startedAt.slice(11, 19),
    durationMs,
    leads,
  };
});
copyFileSync(join(runsDir, defaultSample), join(traceOutputDir, "sample.json"));
writeFileSync(join(traceOutputDir, "index.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(`[build:viewer] output=${outputDir}`);
console.log(`[build:viewer] traces=${traces.length} sample=${defaultSample}`);
