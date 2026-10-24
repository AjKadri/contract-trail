import { readFileSync } from "node:fs";

import type { DatasetTable } from "./manifest.js";

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function readCsvHeader(csvPath: string): string[] {
  const firstLine = readFileSync(csvPath, "utf8").split(/\r?\n/u, 1)[0] ?? "";
  return firstLine
    .replace(/^\uFEFF/u, "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

export function buildTableLoadSql(table: DatasetTable, columns: readonly string[]): string {
  const columnSql = columns.map((column) => `${quoteIdentifier(column)} text`).join(", ");
  return [
    `DROP TABLE IF EXISTS ${quoteIdentifier(table.table)};`,
    `CREATE TABLE ${quoteIdentifier(table.table)} (${columnSql});`,
    `COPY ${quoteIdentifier(table.table)} FROM '/data/${table.sourcePath}' WITH (FORMAT csv, HEADER true);`,
    `SELECT '${table.table}' AS table_name, count(*) AS row_count FROM ${quoteIdentifier(table.table)};`,
  ].join("\n");
}

export function buildDatabaseLoadSql(
  tables: readonly DatasetTable[],
  dataRoot: string,
): string {
  return tables
    .map((table) => buildTableLoadSql(table, readCsvHeader(`${dataRoot}/${table.sourcePath}`)))
    .join("\n");
}
