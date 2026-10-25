import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";

import { dismissLead, DEFAULT_QUESTION, runContractTrail, type TraceEvent } from "../agents/contractTrail.js";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const HMEM_DIR = resolve(ROOT, "runs/.hmem");
const PORT = Number(process.env.CONTRACT_TRAIL_PORT ?? 3001);

type RunQuery = { question?: string };
type DismissBody = { leadId?: string; reason?: string };

function safeToolEvent(event: TraceEvent): unknown {
  if (event.type !== "tool_call" || !event.data || typeof event.data !== "object") return event.data;
  const tool = event.data as Record<string, unknown>;
  const { resultRows: _resultRows, ...summary } = tool;
  return summary;
}

export function buildServer() {
  const app = Fastify({ logger: false });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/config", async () => ({ sampleMode: process.env.SAMPLE_MODE === "true", disclaimer: "Leads, not accusations" }));

  app.post<{ Body: DismissBody }>("/api/dismiss", async (request, reply) => {
    const leadId = request.body?.leadId?.trim();
    const reason = request.body?.reason?.trim();
    if (!leadId || !reason) return reply.code(400).send({ error: "leadId and reason are required" });
    try {
      const result = dismissLead(leadId, reason);
      return { leadId: result.leadId, reason: result.reason, memoryId: result.memory.id, tracePath: result.tracePath };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/memory/reset", async () => {
    rmSync(HMEM_DIR, { recursive: true, force: true });
    return { ok: true, path: HMEM_DIR };
  });

  app.get<{ Querystring: RunQuery }>("/api/run", async (request, reply) => {
    const question = request.query.question?.trim() || DEFAULT_QUESTION;
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown): void => {
      if (response.destroyed) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("status", { status: "running", question, sampleMode: process.env.SAMPLE_MODE === "true" });
    try {
      const result = await runContractTrail(question, {
        onEvent: (event) => send(event.type, event.type === "tool_call" ? safeToolEvent(event) : event.data),
      });
      send("done", { trace: result.trace, tracePath: result.tracePath, leads: result.leads, withdrawnLeads: result.withdrawnLeads, supersededLeads: result.supersededLeads });
    } catch (error) {
      send("error", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      response.end();
    }
  });

  return app;
}

const app = buildServer();
app.listen({ host: process.env.CONTRACT_TRAIL_HOST ?? "127.0.0.1", port: PORT }).then(() => {
  console.log(`[server] Contract Trail API listening on http://127.0.0.1:${PORT}`);
}).catch((error: unknown) => {
  console.error(`[server] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
