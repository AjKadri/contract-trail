import { describe, expect, it } from "vitest";

import { HMEM } from "../src/engines/hmem/index.js";

describe("H-MEM Contract Trail integration", () => {
  it("marks a declared replacement as superseding the old lead", () => {
    const hmem = new HMEM({ clock: () => 1_700_000_000_000 });
    const oldLead = hmem.add({
      content: "The exercise-book lead needs review",
      source: "contract-trail:test:old",
      confidence: 0.8,
    });
    const replacement = hmem.add({
      content: "The exercise-book lead was dismissed after distribution evidence",
      source: "contract-trail:test:dismissal",
      supersedes: oldLead.id,
      confidence: 0.9,
    });

    expect(replacement.supersedes).toBe(oldLead.id);
    expect(hmem.store.get(oldLead.id)?.supersededBy).toBe(replacement.id);
    expect(hmem.store.get(oldLead.id)).toBeDefined();
  });
});
