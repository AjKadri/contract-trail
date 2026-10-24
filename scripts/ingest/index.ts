import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATASET_ARCHIVES,
  DATASET_TABLES,
  TABLES_BY_DATABASE,
  WORLD_BANK_CPI_SOURCE_URL,
} from "./manifest.js";
import { buildDatabaseLoadSql } from "./sql.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = join(ROOT, "spike", "data");
const COMPOSE_FILE = join(ROOT, "infra", "data-compose.yml");
const DOWNLOAD_BASE = "https://data.open-contracting.org/en/publication";
const CPI_JSON_PATH = join(DATA_ROOT, "cpi", "world_bank_fp_cpi_totl_nga.json");
const CPI_CSV_PATH = join(DATA_ROOT, "cpi", "world_bank_fp_cpi_totl_nga.csv");

function run(command: string, args: readonly string[], options: { capture?: boolean } = {}): string {
  const result = execFileSync(command, [...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  // execFileSync returns null when stdio is inherited
  return (result ?? "").toString().trim();
}

function archivePath(publication: number): string {
  return join(DATA_ROOT, `${publication}-full.csv.tar.gz`);
}

function requiredFilesExist(): boolean {
  return DATASET_TABLES.every((table) => existsSync(join(DATA_ROOT, table.sourcePath)));
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function ensureCpiData(): void {
  if (existsSync(CPI_CSV_PATH)) {
    return;
  }

  mkdirSync(dirname(CPI_CSV_PATH), { recursive: true });
  console.log("[ingest] downloading World Bank Nigeria CPI");
  run("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--output",
    CPI_JSON_PATH,
    WORLD_BANK_CPI_SOURCE_URL,
  ], { capture: false });

  const payload = JSON.parse(readFileSync(CPI_JSON_PATH, "utf8")) as unknown;
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    throw new Error("World Bank CPI response did not contain an observations array");
  }

  const rows = payload[1].map((entry: unknown) => {
    const observation = entry as {
      countryiso3code?: unknown;
      date?: unknown;
      value?: unknown;
      indicator?: { id?: unknown; value?: unknown };
    };
    return [
      String(observation.countryiso3code ?? "NGA"),
      String(observation.date ?? ""),
      observation.value === null || observation.value === undefined ? "" : String(observation.value),
      String(observation.indicator?.id ?? "FP.CPI.TOTL"),
      String(observation.indicator?.value ?? "Consumer price index (2010 = 100)"),
    ].map(csvCell).join(",");
  });

  if (rows.length === 0) {
    throw new Error("World Bank CPI response contained no observations");
  }

  writeFileSync(
    CPI_CSV_PATH,
    ["countryiso3code,date,value,indicator_id,indicator_name", ...rows, ""].join("\n"),
    "utf8",
  );
  console.log(`[ingest] prepared states.world_bank_cpi rows=${rows.length}`);
}

function ensureData(): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  ensureCpiData();
  if (requiredFilesExist()) {
    console.log(`[ingest] using existing data under ${DATA_ROOT}`);
    return;
  }

  for (const publication of DATASET_ARCHIVES) {
    const archive = archivePath(publication);
    if (!existsSync(archive)) {
      console.log(`[ingest] downloading publication ${publication}`);
      run("curl", [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--output",
        archive,
        `${DOWNLOAD_BASE}/${publication}/download?name=full.csv.tar.gz`,
      ], { capture: false });
    }

    const extractionDirectory = join(DATA_ROOT, `csv_${publication}`);
    mkdirSync(extractionDirectory, { recursive: true });
    console.log(`[ingest] extracting publication ${publication}`);
    run("tar", ["-xzf", archive, "-C", extractionDirectory], { capture: false });
  }

  if (!requiredFilesExist()) {
    throw new Error("The downloaded archives did not contain the required OCDS CSV files");
  }
}

function ensureDatabase(database: string): void {
  const found = runCompose([
    "exec",
    "-T",
    "ct-pg",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-c",
    `SELECT 1 FROM pg_database WHERE datname = '${database}';`,
  ]);
  if (found === "1") {
    return;
  }

  console.log(`[ingest] creating database ${database}`);
  runCompose([
    "exec",
    "-T",
    "ct-pg",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE ${database};`,
  ], { capture: false });
}

function runCompose(args: readonly string[], options: { capture?: boolean } = {}): string {
  return run("docker", ["compose", "--env-file", join(ROOT, ".env"), "-f", COMPOSE_FILE, ...args], options);
}

function loadDatabase(database: "bpp" | "states"): void {
  const tables = TABLES_BY_DATABASE[database];
  const sqlPath = join(DATA_ROOT, `load_${database}.sql`);
  writeFileSync(sqlPath, `${buildDatabaseLoadSql(tables, DATA_ROOT)}\n`, "utf8");
  console.log(`[ingest] loading ${database} (${tables.length} tables)`);
  runCompose([
    "exec",
    "-T",
    "ct-pg",
    "psql",
    "-U",
    "postgres",
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    `/data/load_${database}.sql`,
  ], { capture: false });
}

function printCounts(): void {
  for (const table of DATASET_TABLES) {
    const count = runCompose([
      "exec",
      "-T",
      "ct-pg",
      "psql",
      "-U",
      "postgres",
      "-d",
      table.database,
      "-At",
      "-c",
      `SELECT count(*) FROM "${table.table}";`,
    ]);
    console.log(`[ingest] ${table.database}.${table.table} rows=${count}`);
  }
}


function waitForPostgres(timeoutMs = 90_000): void {
  const started = Date.now();
  let ok = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      const out = runCompose(["exec", "-T", "ct-pg", "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", "SELECT 1;"]);
      if (out === "1") {
        ok += 1;
        // Require two successes 2s apart: the image's first-start init server answers briefly, then restarts.
        if (ok >= 2) return;
      }
    } catch {
      ok = 0;
    }
    execFileSync("sleep", ["2"]);
  }
  throw new Error("ct-pg did not accept connections within 90s; check `docker compose -f infra/data-compose.yml logs ct-pg`");
}

function main(): void {
  ensureData();
  console.log("[ingest] waiting for ct-pg");
  waitForPostgres();
  ensureDatabase("bpp");
  ensureDatabase("states");
  loadDatabase("bpp");
  loadDatabase("states");
  printCounts();
  console.log("[ingest] complete");
}

main();
