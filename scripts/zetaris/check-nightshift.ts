import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

dotenv.config({ path: resolve(fileURLToPath(new URL("../../.env", import.meta.url))) });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing from .env`);
  }
  return value;
}

async function callNightshift(requestedModel: string): Promise<string> {
  const baseUrl = requiredEnv("METERLESS_BASE_URL").replace(/\/$/u, "");
  const token = requiredEnv("METERLESS_RUNTIME_TOKEN");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "meterless-app": "contract-trail",
      "meterless-scope": "user",
    },
    body: JSON.stringify({
      model: requestedModel,
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      temperature: 0,
      max_tokens: 8,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Nightshift HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = JSON.parse(body) as { model?: unknown; choices?: unknown[] };
  if (typeof payload.model !== "string" || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("Nightshift response did not include a returned model and choice");
  }
  return payload.model;
}

async function main(): Promise<void> {
  const models = [
    ["fast", requiredEnv("METERLESS_FAST_MODEL")],
    ["deep", requiredEnv("METERLESS_DEEP_MODEL")],
  ] as const;

  for (const [lane, requestedModel] of models) {
    const returnedModel = await callNightshift(requestedModel);
    console.log(`[check:nightshift] lane=${lane} requested=${requestedModel} returned=${returnedModel}`);
  }
}

main().catch((error: unknown) => {
  console.error(`[check:nightshift] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
