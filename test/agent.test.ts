import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HMEM } from "../src/engines/hmem/index.js";
import { dismissLead } from "../src/agents/contractTrail.js";

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
});
