import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import {
  DATASOURCES,
  EXPECTED_ZETARIS_TABLES,
  buildCreateDatasourceSql,
  buildRegisterTablesSql,
  buildShowTablesSql,
} from "./sql.js";

dotenv.config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

type ZetarisResponse = {
  data?: unknown;
  columns?: unknown;
  schema?: unknown;
  error?: unknown;
  message?: unknown;
};

class ZetarisError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Zetaris HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing from .env`);
  }
  return value;
}

function isErrorPayload(payload: ZetarisResponse): boolean {
  return payload.error !== undefined || payload.message !== undefined && payload.data === undefined;
}

async function runSql(
  url: string,
  orgId: string,
  apiKey: string,
  sql: string,
): Promise<ZetarisResponse> {
  const response = await fetch(`${url.replace(/\/$/u, "")}/sql-editor/sqls/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Org-ID": orgId,
      "X-Request-ID": crypto.randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queryId: crypto.randomUUID(),
      sql,
      source: "SqlEditor",
      limit: 500,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ZetarisError(response.status, body);
  }

  let parsed: ZetarisResponse;
  try {
    parsed = JSON.parse(body) as ZetarisResponse;
  } catch {
    throw new Error(`Zetaris returned non-JSON output: ${body.slice(0, 300)}`);
  }
  if (isErrorPayload(parsed)) {
    throw new ZetarisError(response.status, body);
  }
  return parsed;
}

function duplicateDatasource(error: unknown): boolean {
  if (!(error instanceof ZetarisError)) {
    return false;
  }
  const message = error.body.toLowerCase();
  return error.status >= 400 &&
    (message.includes("already exists") || message.includes("duplicate") || message.includes("exists"));
}

function tableNames(result: ZetarisResponse): string[] {
  if (!Array.isArray(result.data)) {
    return [];
  }
  return result.data
    .map((row) => Array.isArray(row) ? row[0] : undefined)
    .filter((name): name is string => typeof name === "string")
    .sort();
}

async function main(): Promise<void> {
  const url = requiredEnv("ZETARIS_REST_URL");
  const orgId = requiredEnv("ZETARIS_ORG_ID");
  const apiKey = requiredEnv("ZETARIS_API_KEY");
  const postgresPassword = requiredEnv("CT_PG_PASSWORD");

  for (const datasource of DATASOURCES) {
    try {
      await runSql(url, orgId, apiKey, buildCreateDatasourceSql(datasource, postgresPassword));
      console.log(`[zetaris] created datasource ${datasource.name}`);
    } catch (error) {
      if (!duplicateDatasource(error)) {
        throw error;
      }
      console.log(`[zetaris] datasource ${datasource.name} already exists`);
    }

    await runSql(url, orgId, apiKey, buildRegisterTablesSql(datasource.name));
    const result = await runSql(url, orgId, apiKey, buildShowTablesSql(datasource.name));
    const actual = tableNames(result);
    const expected = [...EXPECTED_ZETARIS_TABLES[datasource.name as keyof typeof EXPECTED_ZETARIS_TABLES]].sort();
    if (actual.join("\n") !== expected.join("\n")) {
      throw new Error(
        `${datasource.name} table registration mismatch: expected ${expected.join(", ")}; got ${actual.join(", ")}`,
      );
    }
    console.log(`[zetaris] ${datasource.name} tables (${actual.length}): ${actual.join(", ")}`);
  }

  console.log("[zetaris] registration complete");
}

main().catch((error: unknown) => {
  console.error(`[zetaris] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
