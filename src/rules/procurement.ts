export type FederalContract = {
  id: string;
  mainOcid: string;
  mainId: string;
  title: string;
  dateSigned: string;
  value: number;
  currency: string;
};

export type FederalItem = {
  contractId: string;
  mainOcid: string;
  mainId: string;
  title: string;
  dateSigned: string;
  value: number;
  currency: string;
  itemId: string;
  quantity: number;
  description: string;
};

export type OyoContract = {
  ocid: string;
  id: string;
  date: string;
  title: string;
  value: number;
  currency: string;
  buyer: string;
  procuringEntity: string;
};

export type CpiPoint = { year: number; value: number };
export const CPI_BASE_YEAR = 2025;
export type LeafCount = 20 | 40 | 60 | 80 | 100;

export type LeafPricedRow = {
  leafCount: LeafCount;
  publisher: "federal" | "oyo";
  evidenceId: string;
  title: string;
  date: string;
  deflatedPricePerBook: number;
  quantity: number;
};

export type LeafMatchedComparison = {
  matchedLeafCounts: LeafCount[];
  federalByLeaf: Record<string, { median: number; count: number; evidenceIds: string[] }>;
  oyoByLeaf: Record<string, { median: number; count: number; evidenceIds: string[] }>;
  federalMedian: number;
  oyoMedian: number;
  ratio: number;
  targetYear: number;
};

export type PricedContract = {
  evidenceId: string;
  publisher: "federal" | "oyo";
  title: string;
  date: string;
  year: number;
  value: number;
  quantity: number;
  nominalPricePerBook: number;
  deflatedPricePerBook: number;
  targetYear: number;
  currency: string;
  details: string[];
  leafCounts: LeafCount[];
  leafCount?: LeafCount;
};

export type DeterministicLead = {
  id: string;
  kind: "price-gap" | "twin-award";
  severity: "high" | "medium" | "low";
  title: string;
  evidenceIds: string[];
  arithmetic: string;
  challengePrompt: string;
  whatToVerify: string;
  sourceContracts: string[];
  comparison?: "all-book" | "matched-leaves" | "no-matched-leaves";
};

export type LeadDisposition = {
  leadId: string;
  disposition: "stand" | "downgrade" | "withdraw";
  reason: string;
};

export type DispositionChange = {
  leadId: string;
  disposition: LeadDisposition["disposition"];
  reason: string;
  before: DeterministicLead["severity"];
  after?: DeterministicLead["severity"];
};

export function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

export function yearOf(value: string): number {
  const match = value.match(/(\d{4})/u);
  return match ? Number(match[1]) : 0;
}

export function normaliseSupplierName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toUpperCase().replace(/[^A-Z0-9]+/gu, " ").trim();
}

export function isBookTitle(title: string): boolean {
  const lower = title.toLowerCase();
  if (/(thinkpad|laptop|computer|pc\b|tablet|printer)/u.test(lower)) return false;
  return /(exercise book|notebook|note book)/u.test(lower);
}

export function isBookItem(description: string): boolean {
  const lower = description.toLowerCase();
  if (/(thinkpad|laptop|computer|pc\b|tablet|printer)/u.test(lower)) return false;
  return /(exercise book|notebook|note book)/u.test(lower);
}

export function extractLeafCount(text: string): LeafCount | undefined {
  const match = text.match(/\b(20|40|60|80|100)\s*(?:leaves?|L)\b/iu);
  if (!match) return undefined;
  return Number(match[1]) as LeafCount;
}

export function normaliseOyoTitle(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function extractQuantityFromOyoTitle(title: string): number {
  const match = title.match(/(?:production|procurement|award|supply|of|for|copies)[^\d]{0,80}(\d[\d,]*)\s*copies?/iu);
  if (match) return numberValue(match[1]);
  const fallback = title.match(/(\d[\d,]*)\s*copies?/iu);
  return fallback ? numberValue(fallback[1]) : 0;
}

export function dedupeLatest<T extends { key: string; date: string; releaseId: string }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prior = latest.get(row.key);
    if (!prior || `${row.date}|${row.releaseId}` > `${prior.date}|${prior.releaseId}`) latest.set(row.key, row);
  }
  return [...latest.values()];
}

export function dedupeOyoContracts(rows: OyoContract[]): OyoContract[] {
  const latestByOcid = dedupeLatest(rows.map((row) => ({ ...row, key: row.ocid, releaseId: row.id })));
  const byFingerprint = new Map<string, OyoContract>();
  for (const row of latestByOcid) {
    const key = `${normaliseOyoTitle(row.title)}|${row.value}|${row.date.slice(0, 10)}`;
    const prior = byFingerprint.get(key);
    if (!prior || `${row.date}|${row.id}` > `${prior.date}|${prior.id}`) byFingerprint.set(key, row);
  }
  return [...byFingerprint.values()];
}

export function deflatePrice(nominalPrice: number, sourceYear: number, cpi: CpiPoint[]): { value: number; targetYear: number } {
  const usable = cpi.filter((point) => point.year > 0 && point.value > 0).sort((a, b) => a.year - b.year);
  if (usable.length === 0 || sourceYear <= 0) return { value: nominalPrice, targetYear: sourceYear };
  const source = usable.find((point) => point.year === sourceYear) ?? usable.reduce((a, b) => Math.abs(b.year - sourceYear) < Math.abs(a.year - sourceYear) ? b : a);
  const target = usable.find((point) => point.year === CPI_BASE_YEAR) ?? usable[usable.length - 1];
  return { value: nominalPrice * target.value / source.value, targetYear: target.year };
}

export function federalItemsToPriced(rows: FederalItem[], cpi: CpiPoint[]): PricedContract[] {
  const releases = new Map<string, Map<string, FederalItem[]>>();
  for (const row of rows) {
    const contractKey = `${row.mainOcid}|${row.contractId}`;
    const contractReleases = releases.get(contractKey) ?? new Map<string, FederalItem[]>();
    const group = contractReleases.get(row.mainId) ?? [];
    group.push(row);
    contractReleases.set(row.mainId, group);
    releases.set(contractKey, contractReleases);
  }
  const contracts: PricedContract[] = [];
  for (const contractReleases of releases.values()) {
    const items = [...contractReleases.values()].sort((left, right) => {
      const leftRow = left[0];
      const rightRow = right[0];
      return `${rightRow.dateSigned}|${rightRow.mainId}`.localeCompare(`${leftRow.dateSigned}|${leftRow.mainId}`);
    })[0] ?? [];
    if (items.length === 0 || !items.every((item) => isBookItem(item.description))) continue;
    const first = items[0];
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!isBookTitle(first.title) || quantity <= 0 || first.value <= 0) continue;
    const nominal = first.value / quantity;
    const deflated = deflatePrice(nominal, yearOf(first.dateSigned), cpi);
    contracts.push({
      evidenceId: `${first.mainOcid}/${first.contractId}`,
      publisher: "federal",
      title: first.title,
      date: first.dateSigned,
      year: yearOf(first.dateSigned),
      value: first.value,
      quantity,
      nominalPricePerBook: nominal,
      deflatedPricePerBook: deflated.value,
      targetYear: deflated.targetYear,
      currency: first.currency,
      details: items.map((item) => `${item.quantity} × ${item.description}`),
      leafCounts: [...new Set(items.map((item) => extractLeafCount(item.description)).filter((leaf): leaf is LeafCount => leaf !== undefined))],
    });
  }
  return contracts;
}

export function oyoToPriced(rows: OyoContract[], cpi: CpiPoint[]): PricedContract[] {
  const latest = dedupeOyoContracts(rows);
  return latest
    .filter((row) => isBookTitle(row.title))
    .map((row) => {
      const quantity = extractQuantityFromOyoTitle(row.title);
      const nominal = quantity > 0 ? row.value / quantity : 0;
      const deflated = deflatePrice(nominal, yearOf(row.date), cpi);
      return {
        evidenceId: `${row.ocid}/${row.id}`,
        publisher: "oyo" as const,
        title: row.title,
        date: row.date,
        year: yearOf(row.date),
        value: row.value,
        quantity,
        nominalPricePerBook: nominal,
        deflatedPricePerBook: deflated.value,
        targetYear: deflated.targetYear,
        currency: row.currency,
        details: [`${quantity} copies parsed from Oyo title`, row.buyer, row.procuringEntity].filter(Boolean),
        leafCounts: extractLeafCount(row.title) ? [extractLeafCount(row.title)!] : [],
        leafCount: extractLeafCount(row.title),
      };
    })
    .filter((row) => row.quantity > 0 && row.value > 0);
}

function latestFederalItemReleases(rows: FederalItem[]): FederalItem[][] {
  const releases = new Map<string, Map<string, FederalItem[]>>();
  for (const row of rows) {
    const contractKey = `${row.mainOcid}|${row.contractId}`;
    const contractReleases = releases.get(contractKey) ?? new Map<string, FederalItem[]>();
    const group = contractReleases.get(row.mainId) ?? [];
    group.push(row);
    contractReleases.set(row.mainId, group);
    releases.set(contractKey, contractReleases);
  }
  return [...releases.values()].map((contractReleases) => [...contractReleases.values()].sort((left, right) => {
    const leftRow = left[0];
    const rightRow = right[0];
    return `${rightRow.dateSigned}|${rightRow.mainId}`.localeCompare(`${leftRow.dateSigned}|${leftRow.mainId}`);
  })[0] ?? []).filter((items) => items.length > 0);
}

export function federalToLeafPrices(rows: FederalItem[], cpi: CpiPoint[]): LeafPricedRow[] {
  const result: LeafPricedRow[] = [];
  for (const items of latestFederalItemReleases(rows)) {
    if (!items.every((item) => isBookItem(item.description))) continue;
    const first = items[0];
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!isBookTitle(first.title) || totalQuantity <= 0 || first.value <= 0) continue;
    const deflated = deflatePrice(first.value / totalQuantity, yearOf(first.dateSigned), cpi);
    const byLeaf = new Map<LeafCount, number>();
    for (const item of items) {
      const leaf = extractLeafCount(item.description);
      if (leaf !== undefined) byLeaf.set(leaf, (byLeaf.get(leaf) ?? 0) + item.quantity);
    }
    for (const [leafCount, quantity] of byLeaf) {
      result.push({
        leafCount,
        publisher: "federal",
        evidenceId: `${first.mainOcid}/${first.contractId}`,
        title: first.title,
        date: first.dateSigned,
        deflatedPricePerBook: deflated.value,
        quantity,
      });
    }
  }
  return result;
}

export function oyoToLeafPrices(rows: OyoContract[], cpi: CpiPoint[]): LeafPricedRow[] {
  return dedupeOyoContracts(rows).flatMap((row) => {
    const leafCount = extractLeafCount(row.title);
    const quantity = extractQuantityFromOyoTitle(row.title);
    if (!isBookTitle(row.title) || leafCount === undefined || quantity <= 0 || row.value <= 0) return [];
    const deflated = deflatePrice(row.value / quantity, yearOf(row.date), cpi);
    return [{
      leafCount,
      publisher: "oyo" as const,
      evidenceId: `${row.ocid}/${row.id}`,
      title: row.title,
      date: row.date,
      deflatedPricePerBook: deflated.value,
      quantity,
    }];
  });
}

export function buildLeafMatchedComparison(federal: LeafPricedRow[], oyo: LeafPricedRow[], targetYear: number): LeafMatchedComparison {
  const federalByLeaf: LeafMatchedComparison["federalByLeaf"] = {};
  const oyoByLeaf: LeafMatchedComparison["oyoByLeaf"] = {};
  for (const leaf of [20, 40, 60, 80, 100] as LeafCount[]) {
    const federalRows = federal.filter((row) => row.leafCount === leaf);
    const oyoRows = oyo.filter((row) => row.leafCount === leaf);
    if (federalRows.length > 0) federalByLeaf[String(leaf)] = { median: median(federalRows.map((row) => row.deflatedPricePerBook)), count: federalRows.length, evidenceIds: [...new Set(federalRows.map((row) => row.evidenceId))] };
    if (oyoRows.length > 0) oyoByLeaf[String(leaf)] = { median: median(oyoRows.map((row) => row.deflatedPricePerBook)), count: oyoRows.length, evidenceIds: [...new Set(oyoRows.map((row) => row.evidenceId))] };
  }
  const matchedLeafCounts = Object.keys(federalByLeaf).map(Number).filter((leaf) => Object.hasOwn(oyoByLeaf, String(leaf))) as LeafCount[];
  const federalPrices = matchedLeafCounts.flatMap((leaf) => federal.filter((row) => row.leafCount === leaf).map((row) => row.deflatedPricePerBook));
  const oyoPrices = matchedLeafCounts.flatMap((leaf) => oyo.filter((row) => row.leafCount === leaf).map((row) => row.deflatedPricePerBook));
  const federalMedian = median(federalPrices);
  const oyoMedian = median(oyoPrices);
  return { matchedLeafCounts, federalByLeaf, oyoByLeaf, federalMedian, oyoMedian, ratio: oyoMedian > 0 ? federalMedian / oyoMedian : 0, targetYear };
}

export function twinAwards(contracts: PricedContract[]): Array<[PricedContract, PricedContract]> {
  const federal = contracts.filter((contract) => contract.publisher === "federal");
  const pairs: Array<[PricedContract, PricedContract]> = [];
  for (let i = 0; i < federal.length; i += 1) {
    for (let j = i + 1; j < federal.length; j += 1) {
      const left = federal[i];
      const right = federal[j];
      const denominator = Math.max((left.value + right.value) / 2, 1);
      if (left.date.slice(0, 10) === right.date.slice(0, 10) && left.quantity === right.quantity && Math.abs(left.value - right.value) / denominator <= 0.01) {
        pairs.push([left, right]);
      }
    }
  }
  return pairs;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function buildDeterministicLeads(federal: PricedContract[], oyo: PricedContract[], comparison?: LeafMatchedComparison): DeterministicLead[] {
  const leads: DeterministicLead[] = [];
  if (federal.length > 0 && oyo.length > 0) {
    const matched = comparison?.matchedLeafCounts.length ? comparison : undefined;
    const federalMedian = matched ? matched.federalMedian : median(federal.map((row) => row.deflatedPricePerBook));
    const oyoMedian = matched ? matched.oyoMedian : median(oyo.map((row) => row.deflatedPricePerBook));
    const ratio = matched ? matched.ratio : oyoMedian > 0 ? federalMedian / oyoMedian : 0;
    const federalIds = matched ? [...new Set(Object.values(matched.federalByLeaf).flatMap((row) => row.evidenceIds))].slice(0, 5) : federal.slice(0, 5).map((row) => row.evidenceId);
    const oyoIds = matched ? [...new Set(Object.values(matched.oyoByLeaf).flatMap((row) => row.evidenceIds))].slice(0, 5) : oyo.slice(0, 5).map((row) => row.evidenceId);
    const leafText = matched ? ` matched leaves ${matched.matchedLeafCounts.join(", ")}` : " without leaf matching";
    leads.push({
      id: "price-gap-federal-vs-oyo",
      kind: "price-gap",
      severity: matched ? ratio >= 2 ? "high" : "medium" : "medium",
      title: "Federal books-only contracts are priced above Oyo peers after CPI adjustment",
      evidenceIds: [...federalIds, ...oyoIds],
      arithmetic: matched ? `Federal median ${federalMedian.toFixed(2)} NGN/book ÷ Oyo median ${oyoMedian.toFixed(2)} NGN/book = ${ratio.toFixed(2)}× on${leafText}, both expressed in ${federal[0].targetYear} CPI terms.` : `No shared leaf count was available, so the all-book comparison is downgraded and not treated as like-for-like.`,
      challengePrompt: "Could leaves, cover, colour, delivery, or school distribution explain the adjusted price gap?",
      whatToVerify: "Verify book specifications, delivered quantities, distribution distances, and whether delivery is included in each award value.",
      sourceContracts: [...federalIds, ...oyoIds],
      comparison: matched ? "matched-leaves" : comparison ? "no-matched-leaves" : "all-book",
    });
  }
  for (const [left, right] of twinAwards(federal)) {
    const difference = Math.abs(left.value - right.value);
    const percentage = difference / Math.max((left.value + right.value) / 2, 1) * 100;
    leads.push({
      id: `twin-award-${left.evidenceId}-${right.evidenceId}`,
      kind: "twin-award",
      severity: "medium",
      title: "Two federal book contracts match on date and quantity with near-identical values",
      evidenceIds: [left.evidenceId, right.evidenceId],
      arithmetic: `${left.quantity.toLocaleString()} books on ${left.date.slice(0, 10)}; values ${left.value.toFixed(2)} NGN and ${right.value.toFixed(2)} NGN differ by ${difference.toFixed(2)} NGN (${percentage.toFixed(3)}%).`,
      challengePrompt: "Could these be separate lots or releases with the same specification and an ordinary procurement explanation?",
      whatToVerify: "Verify the lot boundaries, delivery destinations, specifications, awardees, and whether either row is a duplicate release.",
      sourceContracts: [left.evidenceId, right.evidenceId],
    });
  }
  return leads;
}

export function applyLeadDispositions(leads: DeterministicLead[], dispositions: LeadDisposition[]): { active: DeterministicLead[]; withdrawn: Array<{ lead: DeterministicLead; reason: string }>; changes: DispositionChange[] } {
  const byId = new Map(dispositions.map((decision) => [decision.leadId, decision]));
  const active: DeterministicLead[] = [];
  const withdrawn: Array<{ lead: DeterministicLead; reason: string }> = [];
  const changes: DispositionChange[] = [];
  for (const lead of leads) {
    const decision = byId.get(lead.id);
    if (!decision || decision.disposition === "stand") {
      active.push(lead);
      continue;
    }
    if (decision.disposition === "withdraw") {
      withdrawn.push({ lead, reason: decision.reason });
      changes.push({ leadId: lead.id, disposition: decision.disposition, reason: decision.reason, before: lead.severity });
      continue;
    }
    const after = lead.severity === "high" ? "medium" : "low";
    active.push({ ...lead, severity: after });
    changes.push({ leadId: lead.id, disposition: decision.disposition, reason: decision.reason, before: lead.severity, after });
  }
  return { active, withdrawn, changes };
}
