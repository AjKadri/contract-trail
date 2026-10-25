import { describe, expect, it, vi } from "vitest";

import { callNightshift, parseJsonArray, parseJsonObject, probeModelCall } from "../src/llm/nightshift.js";

describe("M3 Nightshift fallback", () => {
  it("logs one Ultra retry and one Lightning fallback after a timeout", async () => {
    vi.stubEnv("METERLESS_BASE_URL", "http://meterless.test/v1");
    vi.stubEnv("METERLESS_RUNTIME_TOKEN", "test-token");
    vi.stubEnv("METERLESS_FAST_MODEL", "fast-model");
    vi.stubEnv("METERLESS_DEEP_MODEL", "deep-model");
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === "deep-model") {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true });
        });
      }
      return new Response(JSON.stringify({ model: "fast-model", id: "fallback-run", choices: [{ message: { content: "fallback" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await callNightshift({ role: "defence-critic", model: "deep-model", fallbackModel: "fast-model", maxTokens: 2048, timeoutMs: 5, messages: [{ role: "user", content: "test" }] });
    expect(result.content).toBe("fallback");
    expect(result.logs.filter((log) => log.status === "retry" && log.requestedModel === "deep-model")).toHaveLength(2);
    expect(result.logs.filter((log) => log.status === "fallback" && log.fallbackOf === "deep-model")).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe("Nightshift response parsing", () => {
  it("strips reasoning and fences and extracts the first JSON value", () => {
    expect(parseJsonArray("<think>ignore this</think>prefix ```json\n[{\"leadId\":\"x\"}]\n``` trailing")).toEqual([{ leadId: "x" }]);
    expect(parseJsonObject("text before {\"tools\":[\"getNigeriaCpi\"]} text after")).toEqual({ tools: ["getNigeriaCpi"] });
  });

  it("records reasoning_content-only output as a model defect", async () => {
    vi.stubEnv("METERLESS_BASE_URL", "http://meterless.test/v1");
    vi.stubEnv("METERLESS_RUNTIME_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ model: "fast-model", choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: "answer hidden in reasoning" } }], usage: { total_tokens: 12, reasoning_tokens: 8 } }), { status: 200 })));
    const log = await probeModelCall({ role: "reporter", model: "fast-model", maxTokens: 4096, messages: [{ role: "user", content: "test" }] });
    expect(log.modelDefect).toBe("content_empty_reasoning_present");
    expect(log.contentLength).toBe(0);
    expect(log.reasoningContentLength).toBeGreaterThan(0);
    expect(log.reasoningTokens).toBe(8);
    vi.unstubAllGlobals();
  });
});
