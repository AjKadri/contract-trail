import { requiredEnv } from "../../scripts/zetaris/client.js";

export type FailureKind = "timeout" | "empty_response" | "http_error" | "request_error";

export type ModelCallLog = {
  role: string;
  requestedModel: string;
  returnedModel: string | null;
  latencyMs: number;
  maxTokens: number;
  tokens?: number;
  reasoningTokens?: number;
  finishReason?: string | null;
  contentLength?: number;
  reasoningContentLength?: number;
  modelDefect?: "content_empty_reasoning_present";
  receiptOrRunId?: string;
  status: "ok" | "retry" | "fallback" | "error";
  retryReason?: FailureKind;
  failureKind?: FailureKind;
  fallbackOf?: string;
  error?: string;
};

export type ModelCallResult = {
  content: string;
  reasoningContent?: string;
  returnedModel: string | null;
  logs: ModelCallLog[];
};

type ChatResponse = {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown; reasoning_content?: unknown };
    reasoning_content?: unknown;
  }>;
  usage?: Record<string, unknown>;
  id?: unknown;
  run_id?: unknown;
  receipt?: unknown;
  error?: unknown;
  reasoning_content?: unknown;
};

export type CallOptions = {
  role: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens: number;
  fallbackModel?: string;
  timeoutMs?: number;
  retryMaxTokens?: number;
  chatTemplateKwargs?: Record<string, unknown>;
};

export type ProbeCallOptions = Omit<CallOptions, "fallbackModel"> & { retryReason?: FailureKind };

function modelConfig(): { baseUrl: string; token: string; fast: string; deep: string } {
  return {
    baseUrl: requiredEnv("METERLESS_BASE_URL").replace(/\/$/u, ""),
    token: requiredEnv("METERLESS_RUNTIME_TOKEN"),
    fast: process.env.METERLESS_FAST_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
    deep: process.env.METERLESS_DEEP_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b",
  };
}

const ROLE_TIMEOUT_MS: Record<string, number> = {
  "classifier-critic": 25_000,
  reporter: 25_000,
  planner: 45_000,
  "defence-critic": 45_000,
};

export function timeoutForRole(role: string): number {
  return ROLE_TIMEOUT_MS[role] ?? 60_000;
}

function responseContent(payload: ChatResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function responseReasoningContent(payload: ChatResponse): string {
  const value = payload.choices?.[0]?.message?.reasoning_content
    ?? payload.choices?.[0]?.reasoning_content
    ?? payload.reasoning_content;
  return typeof value === "string" ? value.trim() : "";
}

function runId(payload: ChatResponse): string | undefined {
  const id = payload.receipt ?? payload.run_id ?? payload.id;
  return typeof id === "string" ? id : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function usageTokens(payload: ChatResponse): { total?: number; reasoning?: number } {
  const usage = payload.usage ?? {};
  const details = usage.completion_tokens_details;
  const detailReasoning = details && typeof details === "object" ? (details as Record<string, unknown>).reasoning_tokens : undefined;
  return {
    total: numberField(usage.total_tokens) ?? numberField(usage.completion_tokens),
    reasoning: numberField(usage.reasoning_tokens) ?? numberField(usage.reasoningTokens) ?? numberField(detailReasoning),
  };
}

function finishReason(payload: ChatResponse): string | null {
  const value = payload.choices?.[0]?.finish_reason;
  return typeof value === "string" ? value : value == null ? null : String(value);
}

function makeLog(options: ProbeCallOptions, payload: ChatResponse, started: number, maxTokens: number, content: string, reasoningContent: string, status: ModelCallLog["status"], retryReason?: FailureKind, error?: string, failureKind?: FailureKind): ModelCallLog {
  const usage = usageTokens(payload);
  const defect = !content && reasoningContent ? "content_empty_reasoning_present" as const : undefined;
  return {
    role: options.role,
    requestedModel: options.model,
    returnedModel: typeof payload.model === "string" ? payload.model : null,
    latencyMs: Date.now() - started,
    maxTokens,
    tokens: usage.total,
    reasoningTokens: usage.reasoning,
    finishReason: finishReason(payload),
    contentLength: content.length,
    reasoningContentLength: reasoningContent.length,
    modelDefect: defect,
    receiptOrRunId: runId(payload),
    status,
    retryReason,
    failureKind,
    error,
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; message?: unknown };
  const name = typeof value.name === "string" ? value.name.toLowerCase() : "";
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  return name === "timeouterror" || message.includes("timeout") || message.includes("timed out") || message.includes("aborted due to timeout");
}

function requestFailureKind(error: unknown): FailureKind {
  return isTimeoutError(error) ? "timeout" : "request_error";
}

async function singleCall(options: ProbeCallOptions, maxTokens: number, retryReason?: FailureKind): Promise<ModelCallResult> {
  const started = Date.now();
  let payload: ChatResponse = {};
  try {
    const config = modelConfig();
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "meterless-app": "contract-trail",
        "meterless-scope": "user",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: 0,
        max_tokens: maxTokens,
        ...(options.chatTemplateKwargs ? { chat_template_kwargs: options.chatTemplateKwargs } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? timeoutForRole(options.role)),
    });
    const body = await response.text();
    try {
      payload = JSON.parse(body) as ChatResponse;
    } catch {
      throw new Error(`Nightshift returned non-JSON output: ${body.slice(0, 240)}`);
    }
    const content = responseContent(payload);
    const reasoningContent = responseReasoningContent(payload);
    if (!response.ok || payload.error) {
      const log = makeLog(options, payload, started, maxTokens, content, reasoningContent, "error", retryReason, undefined, "http_error");
      log.status = "error";
      log.error = `provider_error ${typeof payload.error === "string" ? payload.error : body.slice(0, 240)}`;
      throw Object.assign(new Error(log.error), { callLog: log });
    }
    if (!content) {
      const log = makeLog(options, payload, started, maxTokens, content, reasoningContent, "error", retryReason, undefined, "empty_response");
      throw Object.assign(new Error(reasoningContent ? "empty_response_reasoning_content_present" : "empty_response"), { callLog: log });
    }
    const log = makeLog(options, payload, started, maxTokens, content, reasoningContent, retryReason ? "retry" : "ok", retryReason);
    return { content, reasoningContent: reasoningContent || undefined, returnedModel: log.returnedModel, logs: [log] };
  } catch (error) {
    const existing = (error as Error & { callLog?: ModelCallLog }).callLog;
    if (existing) throw error;
    const log = makeLog(options, payload, started, maxTokens, responseContent(payload), responseReasoningContent(payload), "error", retryReason, error instanceof Error ? error.message : String(error), requestFailureKind(error));
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { callLog: log });
  }
}

export async function callNightshift(options: CallOptions): Promise<ModelCallResult> {
  const logs: ModelCallLog[] = [];
  try {
    return await singleCall(options, Math.max(options.maxTokens, 1024));
  } catch (error) {
    const firstLog = (error as Error & { callLog?: ModelCallLog }).callLog;
    const firstReason = firstLog?.failureKind ?? "request_error";
    if (firstLog) logs.push({ ...firstLog, status: "retry", retryReason: firstReason });
    try {
      const retried = await singleCall(options, options.retryMaxTokens ?? Math.max(options.maxTokens * 2, 4096), firstReason);
      return { ...retried, logs: [...logs, ...retried.logs] };
    } catch (retryError) {
      const retryLog = (retryError as Error & { callLog?: ModelCallLog }).callLog;
      const retryReason = retryLog?.failureKind ?? firstReason;
      if (retryLog) logs.push({ ...retryLog, status: "retry", retryReason });
      if (options.fallbackModel && options.fallbackModel !== options.model) {
        try {
          const fallback = await singleCall({ role: options.role, model: options.fallbackModel, messages: options.messages, maxTokens: options.maxTokens, timeoutMs: options.timeoutMs, retryMaxTokens: options.retryMaxTokens, chatTemplateKwargs: options.chatTemplateKwargs }, Math.max(options.maxTokens, 2048), retryReason);
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

export async function probeModelCall(options: ProbeCallOptions): Promise<ModelCallLog> {
  try {
    const result = await singleCall(options, Math.max(options.maxTokens, 1024), options.retryReason);
    return result.logs[0];
  } catch (error) {
    return (error as Error & { callLog?: ModelCallLog }).callLog ?? {
      role: options.role,
      requestedModel: options.model,
      returnedModel: null,
      latencyMs: 0,
      maxTokens: options.maxTokens,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function stripCodeFences(content: string): string {
  return content.replace(/```(?:json)?/giu, "").replace(/```/gu, "").trim();
}

export function cleanModelContent(content: string): string {
  const reasoningEnd = content.lastIndexOf("</think>");
  return stripCodeFences(reasoningEnd >= 0 ? content.slice(reasoningEnd + "</think>".length) : content);
}

export function extractFirstJsonValue(content: string): unknown {
  const source = cleanModelContent(content);
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== "{" && source[start] !== "[") continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.at(-1) !== expected) break;
        stack.pop();
        if (stack.length === 0) {
          try { return JSON.parse(source.slice(start, index + 1)) as unknown; } catch { break; }
        }
      }
    }
  }
  return undefined;
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const value = extractFirstJsonValue(content);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseJsonArray(content: string): unknown[] {
  const value = extractFirstJsonValue(content);
  return Array.isArray(value) ? value : [];
}

export function fastModel(): string { return modelConfig().fast; }
export function deepModel(): string { return modelConfig().deep; }
