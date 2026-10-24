import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DATASET_ARCHIVES, DATASET_TABLES, TABLES_BY_DATABASE } from "./manifest.js";
import { buildDatabaseLoadSql } from "./sql.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = join(ROOT, "spike", "data");
const COMPOSE_FILE = join(ROOT, "infra", "data-compose.yml");
const DOWNLOAD_BASE = "https://data.open-contracting.org/en/publication";

function run(command: string, args: readonly string[], options: { capture?: boolean } = {}): string {
  const result = execFileSync(command, [...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return result.trim();
}

function archivePath(publication: number): string {
  return join(DATA_ROOT, `${publication}-full.csv.tar.gz`);
}

function requiredFilesExist(): boolean {
  return DATASET_TABLES.every((table) => existsSync(join(DATA_ROOT, table.sourcePath)));
}

function ensureData(): void {
  mkdirSync(DATA_ROOT, { recursive: true });
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
  return run("docker", ["compose", "-f", COMPOSE_FILE, ...args], options);
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

function main(): void {
  ensureData();
  ensureDatabase("bpp");
  ensureDatabase("states");
  loadDatabase("bpp");
  loadDatabase("states");
  printCounts();
  console.log("[ingest] complete");
}

main();
