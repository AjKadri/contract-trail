import { describe, expect, it } from "vitest";

import {
  applyLeadDispositions,
  buildLeafMatchedComparison,
  CPI_BASE_YEAR,
  deflatePrice,
  federalItemsToPriced,
  federalToLeafPrices,
  extractLeafCount,
  oyoToLeafPrices,
  oyoToPriced,
  twinAwards,
  type DeterministicLead,
  type FederalItem,
  type OyoContract,
} from "../src/rules/procurement.js";

const cpi = [{ year: 2023, value: 100 }, { year: 2025, value: 120 }];

function federal(overrides: Partial<FederalItem> = {}): FederalItem {
  return {
    contractId: "1",
    mainOcid: "ocds-test-1",
    mainId: "release-2024",
    title: "Printing of exercise books",
    dateSigned: "2024-10-15T00:00:00Z",
    value: 1_000,
    currency: "NGN",
    itemId: "item-1",
    quantity: 10,
    description: "60 leaves exercise books",
    ...overrides,
  };
}

function oyo(overrides: Partial<OyoContract> = {}): OyoContract {
  return {
    ocid: "oyo-1",
    id: "release-1",
    date: "2022-01-18T00:00:00Z",
    title: "Award of contract for 200,000 copies of 60 leaves customized exercise books",
    value: 20_000,
    currency: "NGN",
    buyer: "Oyo",
    procuringEntity: "Education Trust Fund",
    ...overrides,
  };
}

function lead(overrides: Partial<DeterministicLead> = {}): DeterministicLead {
  return {
    id: "lead-1",
    kind: "price-gap",
    severity: "high",
    title: "A lead to verify",
    evidenceIds: ["evidence-1"],
    arithmetic: "10 ÷ 2",
    challengePrompt: "Check it",
    whatToVerify: "Check it",
    sourceContracts: ["evidence-1"],
    ...overrides,
  };
}

describe("M3 deterministic procurement rules", () => {
  it("excludes laptop notebook items and keeps only the latest federal release", () => {
    const rows = [
      federal({ mainId: "old", dateSigned: "2023-01-01T00:00:00Z", quantity: 5, value: 500 }),
      federal({ mainId: "new", dateSigned: "2024-01-01T00:00:00Z", quantity: 10, value: 1_000 }),
      federal({ contractId: "laptop", title: "Procurement of Notebook Thinkpad T14", description: "Notebook Thinkpad T14", quantity: 4 }),
    ];
    const priced = federalItemsToPriced(rows, cpi);
    expect(priced).toHaveLength(1);
    expect(priced[0].quantity).toBe(10);
    expect(priced[0].evidenceId).toBe("ocds-test-1/1");
  });

  it("deflates nominal prices to the 2025 CPI base year", () => {
    expect(CPI_BASE_YEAR).toBe(2025);
    expect(deflatePrice(10, 2023, cpi)).toEqual({ value: 12, targetYear: 2025 });
  });

  it("applies twin-award matching and deterministic critic dispositions", () => {
    const priced = federalItemsToPriced([
      federal({ contractId: "a", mainOcid: "ocds-a", value: 1_000 }),
      federal({ contractId: "b", mainOcid: "ocds-b", value: 1_005 }),
    ], cpi);
    expect(twinAwards(priced)).toHaveLength(1);
    const applied = applyLeadDispositions([lead(), lead({ id: "lead-2", severity: "medium" })], [
      { leadId: "lead-1", disposition: "downgrade", reason: "specification remains unresolved" },
      { leadId: "lead-2", disposition: "withdraw", reason: "duplicate release" },
    ]);
    expect(applied.active[0].severity).toBe("medium");
    expect(applied.withdrawn[0].reason).toBe("duplicate release");
    expect(applied.changes[0]).toMatchObject({ before: "high", after: "medium" });
  });

  it("deduplicates the Oyo Lot 8 triplicate across different OCIDs", () => {
    const rows = [
      oyo({ ocid: "lot-8-a" }),
      oyo({ ocid: "lot-8-b" }),
      oyo({ ocid: "lot-8-c" }),
    ];
    expect(oyoToPriced(rows, cpi)).toHaveLength(1);
  });

  it("matches federal and Oyo medians by deterministic leaf count", () => {
    expect(extractLeafCount("CUSTOMISED EXERCISE BOOK (80L)")).toBe(80);
    const federalRows = [federal({ value: 1_000, quantity: 10, description: "60 leaves exercise books" })];
    const oyoRows = [oyo({ value: 20_000, title: "200,000 copies of 60 leaves customized exercise books" })];
    const comparison = buildLeafMatchedComparison(federalToLeafPrices(federalRows, cpi), oyoToLeafPrices(oyoRows, cpi), 2025);
    expect(comparison.matchedLeafCounts).toEqual([60]);
    expect(comparison.ratio).toBeGreaterThan(0);
  });
});
