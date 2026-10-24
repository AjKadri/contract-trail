import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

dotenv.config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

export type ZetarisResponse = {
  data?: unknown;
  columns?: unknown;
  schema?: unknown;
  error?: unknown;
  message?: unknown;
};

export class ZetarisHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Zetaris HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing from .env`);
  }
  return value;
}

function isErrorPayload(payload: ZetarisResponse): boolean {
  return payload.error !== undefined ||
    payload.message !== undefined && payload.data === undefined;
}

export async function runZetarisSql(sql: string, limit = 500): Promise<ZetarisResponse> {
  const url = requiredEnv("ZETARIS_REST_URL");
  const orgId = requiredEnv("ZETARIS_ORG_ID");
  const apiKey = requiredEnv("ZETARIS_API_KEY");
  const response = await fetch(`${url.replace(/\/$/u, "")}/sql-editor/sqls/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Org-ID": orgId,
      "X-Request-ID": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queryId: randomUUID(),
      sql,
      source: "SqlEditor",
      limit,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ZetarisHttpError(response.status, body);
  }

  let parsed: ZetarisResponse;
  try {
    parsed = JSON.parse(body) as ZetarisResponse;
  } catch {
    throw new Error(`Zetaris returned non-JSON output: ${body.slice(0, 300)}`);
  }
  if (isErrorPayload(parsed)) {
    throw new ZetarisHttpError(response.status, body);
  }
  return parsed;
}

export function isAlreadyExists(error: unknown): boolean {
  if (!(error instanceof ZetarisHttpError)) {
    return false;
  }
  const message = error.body.toLowerCase();
  return error.status >= 400 &&
    (message.includes("already exists") || message.includes("duplicate") || message.includes("exists"));
}

export function rows(result: ZetarisResponse): unknown[][] {
  if (!Array.isArray(result.data)) {
    return [];
  }
  return result.data.filter((row): row is unknown[] => Array.isArray(row));
}
