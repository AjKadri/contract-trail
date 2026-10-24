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
};

export type DeterministicLead = {
  id: string;
  kind: "price-gap" | "twin-award";
  severity: "high" | "medium";
  title: string;
  evidenceIds: string[];
  arithmetic: string;
  challengePrompt: string;
  whatToVerify: string;
  sourceContracts: string[];
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

export function deflatePrice(nominalPrice: number, sourceYear: number, cpi: CpiPoint[]): { value: number; targetYear: number } {
  const usable = cpi.filter((point) => point.year > 0 && point.value > 0).sort((a, b) => a.year - b.year);
  if (usable.length === 0 || sourceYear <= 0) return { value: nominalPrice, targetYear: sourceYear };
  const source = usable.find((point) => point.year === sourceYear) ?? usable.reduce((a, b) => Math.abs(b.year - sourceYear) < Math.abs(a.year - sourceYear) ? b : a);
  const target = usable[usable.length - 1];
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
    });
  }
  return contracts;
}

export function oyoToPriced(rows: OyoContract[], cpi: CpiPoint[]): PricedContract[] {
  const latest = dedupeLatest(rows.map((row) => ({ ...row, key: row.ocid, releaseId: row.id })));
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
      };
    })
    .filter((row) => row.quantity > 0 && row.value > 0);
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

export function buildDeterministicLeads(federal: PricedContract[], oyo: PricedContract[]): DeterministicLead[] {
  const leads: DeterministicLead[] = [];
  if (federal.length > 0 && oyo.length > 0) {
    const federalMedian = median(federal.map((row) => row.deflatedPricePerBook));
    const oyoMedian = median(oyo.map((row) => row.deflatedPricePerBook));
    const ratio = oyoMedian > 0 ? federalMedian / oyoMedian : 0;
    const federalIds = federal.slice(0, 5).map((row) => row.evidenceId);
    const oyoIds = oyo.slice(0, 5).map((row) => row.evidenceId);
    leads.push({
      id: "price-gap-federal-vs-oyo",
      kind: "price-gap",
      severity: ratio >= 2 ? "high" : "medium",
      title: "Federal books-only contracts are priced above Oyo peers after CPI adjustment",
      evidenceIds: [...federalIds, ...oyoIds],
      arithmetic: `Federal median ${federalMedian.toFixed(2)} NGN/book ÷ Oyo median ${oyoMedian.toFixed(2)} NGN/book = ${ratio.toFixed(2)}×, both expressed in ${federal[0].targetYear} CPI terms.`,
      challengePrompt: "Could leaves, cover, colour, delivery, or school distribution explain the adjusted price gap?",
      whatToVerify: "Verify book specifications, delivered quantities, distribution distances, and whether delivery is included in each award value.",
      sourceContracts: [...federalIds, ...oyoIds],
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
