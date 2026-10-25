import { dismissLead, DEFAULT_QUESTION, runContractTrail } from "../agents/contractTrail.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--dismiss") {
    const leadId = args[1];
    const reason = args.slice(2).join(" ").trim();
    if (!leadId || !reason) throw new Error('usage: npm run ask -- --dismiss <leadId> "<reason>"');
    const result = dismissLead(leadId, reason);
    console.log(`[ask] dismissal stored lead=${result.leadId} memory=${result.memory.id}`);
    console.log(`[ask] reason=${result.reason}`);
    console.log(`[ask] supersedes=${result.previousMemoryId}`);
    console.log(`[ask] trace=${result.tracePath}`);
    return;
  }

  const question = args.join(" ").trim() || DEFAULT_QUESTION;
  const result = await runContractTrail(question);
  console.log(`[ask] mode=${result.trace.mode}`);
  console.log(`[ask] question=${question}`);
  console.log(`[ask] lead list (${result.leads.length})`);
  for (const lead of result.leads) {
    console.log(`[ask] lead=${lead.id} severity=${lead.severity} title=${lead.title}`);
    console.log(`[ask] evidence=${lead.evidenceIds.join(", ")}`);
    console.log(`[ask] arithmetic=${lead.arithmetic}`);
  }
  for (const change of result.trace.dispositionChanges) console.log(`[ask] disposition lead=${change.leadId}=${change.disposition} before=${change.before} after=${change.after ?? "withdrawn"} reason=${change.reason}`);
  for (const lead of result.withdrawnLeads) console.log(`[ask] withdrawn lead=${lead.leadId} before=${lead.severityBefore} reason=${lead.reason}`);
  for (const request of result.trace.criticRequests) console.log(`[ask] critic_requested tool=${request.tool} round=${request.round} status=${request.status}`);
  if (result.trace.leafMatchedComparison) console.log(`[ask] leaf_matched_ratio=${result.trace.leafMatchedComparison.ratio.toFixed(2)}x matched_leaves=${result.trace.leafMatchedComparison.matchedLeafCounts.join(",") || "none"}`);
  for (const lead of result.supersededLeads) console.log(`[ask] superseded lead=${lead.leadId} memory=${lead.memoryId} reason=${lead.reason}`);
  console.log(`[ask] critic challenge=${result.trace.criticChallenges[0]?.challenge ?? "none"}`);
  console.log(`[ask] trace=${result.tracePath}`);
  console.log(`[ask] total_run_ms=${result.trace.totalRunMs}`);
  console.log(`[ask] supplier_context=${result.trace.supplierContext.length} cross-publisher suppliers`);
  console.log("[ask] model_ids");
  for (const call of result.trace.modelCalls) console.log(`[ask] ${call.role} requested=${call.requestedModel} returned=${call.returnedModel ?? "unknown"} status=${call.status}`);
}

main().catch((error: unknown) => {
  console.error(`[ask] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
