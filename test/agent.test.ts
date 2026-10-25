import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HMEM } from "../src/engines/hmem/index.js";
import { dismissLead, shouldRunCriticTool } from "../src/agents/contractTrail.js";
import { buildToolSelectionPrompt } from "../src/data/queries.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("M3 dismiss memory", () => {
  it("supersedes a lead and exposes the dismissal on the next H-MEM load", () => {
    const dir = mkdtempSync(join(tmpdir(), "contract-trail-m3-"));
    tempDirs.push(dir);
    const first = new HMEM({ persistDir: dir, actor: "contract-trail" });
    const old = first.add({ content: "lead:price-gap-federal-vs-oyo Federal price gap", source: "test:lead", tags: ["lead:price-gap-federal-vs-oyo", "lead"], type: "factual" });
    const result = dismissLead("price-gap-federal-vs-oyo", "price includes distribution to 40 schools", dir, dir);
    const next = new HMEM({ persistDir: dir, actor: "contract-trail" });
    expect(result.memory.supersedes).toBe(old.id);
    expect(next.store.get(old.id)?.supersededBy).toBe(result.memory.id);
    expect(next.store.get(result.memory.id)?.content).toContain("price includes distribution");
  });

  it("supports an explicit memory file for a clean demo state", () => {
    const dir = mkdtempSync(join(tmpdir(), "contract-trail-memory-file-"));
    tempDirs.push(dir);
    const memoryFile = join(dir, "demo-memory.json");
    const persistDir = join(dir, ".contract-trail-memory-demo-memory.json");
    const hmem = new HMEM({ persistDir, actor: "contract-trail" });
    hmem.add({ content: "lead:price-gap-federal-vs-oyo Federal price gap", source: "test:lead", tags: ["lead:price-gap-federal-vs-oyo", "lead"], type: "factual" });
    const result = dismissLead("price-gap-federal-vs-oyo", "explicit demo correction", undefined, dir, memoryFile);
    expect(existsSync(memoryFile)).toBe(true);
    expect(result.memory.content).toContain("explicit demo correction");
  });

  it("defers leaf comparison until the defence critic asks for it", () => {
    expect(shouldRunCriticTool([], "getLeafMatchedComparison")).toBe(false);
    expect(shouldRunCriticTool([{ tool: "getLeafMatchedComparison", params: {}, round: 1, status: "rejected" }], "getLeafMatchedComparison")).toBe(false);
    expect(shouldRunCriticTool([{ tool: "getLeafMatchedComparison", params: {}, round: 1, status: "executed" }], "getLeafMatchedComparison")).toBe(true);
    const prompt = buildToolSelectionPrompt("book prices", "{} ");
    expect(prompt).toContain("Do not select getLeafMatchedComparison");
    expect(prompt).toMatch(/using only these names: searchFederalBookContracts, getFederalBookContractItems, searchOyoBookContracts, getNigeriaCpi, getCrossPublisherSuppliers/u);
  });
});
