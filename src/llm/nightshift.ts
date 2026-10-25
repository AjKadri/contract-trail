import { requiredEnv } from "../../scripts/zetaris/client.js";

export type ModelCallLog = {
  role: string;
  requestedModel: string;
  returnedModel: string | null;
  latencyMs: number;
  maxTokens: number;
  tokens?: number;
  receiptOrRunId?: string;
  status: "ok" | "retry" | "fallback" | "error";
  retryReason?: string;
  fallbackOf?: string;
  error?: string;
};

export type ModelCallResult = {
  content: string;
  returnedModel: string | null;
  logs: ModelCallLog[];
};

type ChatResponse = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { total_tokens?: unknown; completion_tokens?: unknown };
  id?: unknown;
  run_id?: unknown;
  receipt?: unknown;
  error?: unknown;
};

export type CallOptions = {
  role: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens: number;
  fallbackModel?: string;
  timeoutMs?: number;
};

function modelConfig(): { baseUrl: string; token: string; fast: string; deep: string } {
  return {
    baseUrl: requiredEnv("METERLESS_BASE_URL").replace(/\/$/u, ""),
    token: requiredEnv("METERLESS_RUNTIME_TOKEN"),
    fast: process.env.METERLESS_FAST_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
    deep: process.env.METERLESS_DEEP_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b",
  };
}

function responseContent(payload: ChatResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function runId(payload: ChatResponse): string | undefined {
  const id = payload.receipt ?? payload.run_id ?? payload.id;
  return typeof id === "string" ? id : undefined;
}

async function singleCall(options: CallOptions, maxTokens: number, retryReason?: string): Promise<ModelCallResult> {
  const started = Date.now();
  let payload: ChatResponse = {};
  try {
    const response = await fetch(`${modelConfig().baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${modelConfig().token}`,
        "Content-Type": "application/json",
        "meterless-app": "contract-trail",
        "meterless-scope": "user",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    const body = await response.text();
    try {
      payload = JSON.parse(body) as ChatResponse;
    } catch {
      throw new Error(`Nightshift returned non-JSON output: ${body.slice(0, 240)}`);
    }
    if (!response.ok || payload.error) {
      throw new Error(`provider_error ${typeof payload.error === "string" ? payload.error : body.slice(0, 240)}`);
    }
    const content = responseContent(payload);
    const log: ModelCallLog = {
      role: options.role,
      requestedModel: options.model,
      returnedModel: typeof payload.model === "string" ? payload.model : null,
      latencyMs: Date.now() - started,
      maxTokens,
      tokens: typeof payload.usage?.total_tokens === "number" ? payload.usage.total_tokens : typeof payload.usage?.completion_tokens === "number" ? payload.usage.completion_tokens : undefined,
      receiptOrRunId: runId(payload),
      status: content ? (retryReason ? "retry" : "ok") : "retry",
      retryReason: content ? retryReason : retryReason ?? "empty_response",
    };
    if (!content) throw Object.assign(new Error("empty_response"), { callLog: log });
    return { content, returnedModel: log.returnedModel, logs: [log] };
  } catch (error) {
    const baseLog: ModelCallLog = {
      role: options.role,
      requestedModel: options.model,
      returnedModel: typeof payload.model === "string" ? payload.model : null,
      latencyMs: Date.now() - started,
      maxTokens,
      receiptOrRunId: runId(payload),
      status: "error",
      retryReason,
      error: error instanceof Error ? error.message : String(error),
    };
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { callLog: baseLog });
  }
}

export async function callNightshift(options: CallOptions): Promise<ModelCallResult> {
  const logs: ModelCallLog[] = [];
  try {
    return await singleCall(options, Math.max(options.maxTokens, 1024));
  } catch (error) {
    const firstLog = (error as Error & { callLog?: ModelCallLog }).callLog;
    if (firstLog) logs.push({ ...firstLog, status: "retry" });
    try {
      const retried = await singleCall(options, Math.max(options.maxTokens * 2, 4096), "empty_response_or_provider_error");
      return { ...retried, logs: [...logs, ...retried.logs] };
    } catch (retryError) {
      const retryLog = (retryError as Error & { callLog?: ModelCallLog }).callLog;
      if (retryLog) logs.push({ ...retryLog, status: "retry" });
      if (options.fallbackModel && options.fallbackModel !== options.model) {
        try {
          const fallback = await singleCall({ ...options, model: options.fallbackModel, fallbackModel: undefined }, Math.max(options.maxTokens, 2048), "ultra_timeout_or_provider_error");
          return {
            ...fallback,
            logs: [...logs, ...fallback.logs.map((log) => ({ ...log, status: "fallback" as const, fallbackOf: options.model }))],
          };
        } catch (fallbackError) {
          const fallbackLog = (fallbackError as Error & { callLog?: ModelCallLog }).callLog;
          if (fallbackLog) logs.push({ ...fallbackLog, status: "error", fallbackOf: options.model });
        }
      }
      throw Object.assign(retryError instanceof Error ? retryError : new Error(String(retryError)), { modelLogs: logs });
    }
  }
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const fenced = cleanModelContent(content).replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const value = JSON.parse(fenced.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(content: string): unknown[] {
  const fenced = cleanModelContent(content).replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const value = JSON.parse(fenced.slice(start, end + 1)) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function cleanModelContent(content: string): string {
  const reasoningEnd = content.lastIndexOf("</think>");
  return reasoningEnd >= 0 ? content.slice(reasoningEnd + "</think>".length) : content;
}

export function fastModel(): string { return modelConfig().fast; }
export function deepModel(): string { return modelConfig().deep; }
