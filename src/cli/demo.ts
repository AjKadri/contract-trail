import { basename } from "node:path";

import { findRecordedTrace, loadRecordedTrace } from "../replay/sample.js";

const tracePath = process.env.SAMPLE_TRACE ?? findRecordedTrace();
const result = loadRecordedTrace(tracePath);
const modelIds = [...new Set(result.trace.modelCalls.map((call) => call.returnedModel ?? call.requestedModel).filter(Boolean))];
const savedRows = result.trace.toolCalls.reduce((total, call) => total + call.resultRows.length, 0);

console.log(`[demo] REPLAYED trace=${basename(result.tracePath)}`);
console.log(`[demo] question=${result.trace.question}`);
console.log(`[demo] saved_rows=${savedRows} tool_calls=${result.trace.toolCalls.length} model_outputs=${Object.keys(result.trace.modelOutputs).length}`);
console.log(`[demo] model_ids=${modelIds.join(", ")}`);
console.log(`[demo] leads=${result.leads.length} withdrawn=${result.withdrawnLeads.length} superseded=${result.supersededLeads.length}`);
for (const lead of result.leads) console.log(`[demo] lead=${lead.id} severity=${lead.severity}`);
