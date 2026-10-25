import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const sourceDir = join(ROOT, "docs", "viewer-src");
const outputDir = join(ROOT, "docs", "viewer");
const traceOutputDir = join(outputDir, "traces");
const runsDir = join(ROOT, "runs");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(traceOutputDir, { recursive: true });
for (const file of ["index.html", "viewer.js", "viewer.css"]) copyFileSync(join(sourceDir, file), join(outputDir, file));

const traces = readdirSync(runsDir)
  .filter((file) => file.endsWith(".json") && file.includes("-are-the-exercise-book-contracts-in-federal-const"))
  .filter((file) => !file.startsWith("probe-") && !file.includes("-dismiss-"))
  .sort();
const latest = traces.at(-1);
if (!latest) throw new Error("No real investigation traces found under runs/");
copyFileSync(join(runsDir, latest), join(traceOutputDir, "sample.json"));
const catalog = ["sample.json"];
writeFileSync(join(traceOutputDir, "index.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(`[build:viewer] output=${outputDir}`);
console.log(`[build:viewer] traces=${traces.length} sample=${latest}`);
