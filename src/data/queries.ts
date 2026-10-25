export type QueryToolName =
  | "searchFederalBookContracts"
  | "getFederalBookContractItems"
  | "getLeafMatchedComparison"
  | "searchOyoBookContracts"
  | "getNigeriaCpi"
  | "getCrossPublisherSuppliers";

export type TypedQuery = {
  name: QueryToolName;
  sql: string;
  limit: number;
};

const FEDERAL_TITLE_FILTER = [
  "lower(c.title) LIKE '%exercise book%'",
  "lower(c.title) LIKE '%notebook%'",
  "lower(c.title) LIKE '%note book%'",
].join(" OR ");

const OYO_TITLE_FILTER = [
  "lower(tender_title) LIKE '%exercise book%'",
  "lower(tender_title) LIKE '%notebook%'",
  "lower(tender_title) LIKE '%note book%'",
].join(" OR ");

export function buildTypedQuery(name: QueryToolName): TypedQuery {
  switch (name) {
    case "searchFederalBookContracts":
      return {
        name,
        limit: 500,
        sql: [
          "SELECT c.id, c.main_ocid, c.main_id, c.title, c.dateSigned, c.value_amount, c.value_currency",
          "FROM bpp_pg.bpp_contracts c",
          `WHERE ${FEDERAL_TITLE_FILTER}`,
          "ORDER BY c.dateSigned DESC, c.id DESC",
        ].join(" "),
      };
    case "getFederalBookContractItems":
      return {
        name,
        limit: 2_000,
        sql: [
          "SELECT c.id, c.main_ocid, c.main_id, c.title, c.dateSigned, c.value_amount, c.value_currency,",
          "i.id, i.quantity, i.description, i.contracts_id",
          "FROM bpp_pg.bpp_contracts c",
          "JOIN bpp_pg.bpp_contracts_items i ON i.main_ocid = c.main_ocid AND i.main_id = c.main_id AND i.contracts_id = c.id",
          `WHERE (${FEDERAL_TITLE_FILTER})`,
          "ORDER BY c.dateSigned DESC, c.id DESC, i.id",
        ].join(" "),
      };
    case "getLeafMatchedComparison":
      return {
        name,
        limit: 2_000,
        sql: [
          "SELECT c.id, c.main_ocid, c.main_id, c.title, c.dateSigned, c.value_amount, c.value_currency,",
          "i.id, i.quantity, i.description, i.contracts_id",
          "FROM bpp_pg.bpp_contracts c",
          "JOIN bpp_pg.bpp_contracts_items i ON i.main_ocid = c.main_ocid AND i.main_id = c.main_id AND i.contracts_id = c.id",
          `WHERE (${FEDERAL_TITLE_FILTER})`,
          "ORDER BY c.dateSigned DESC, c.id DESC, i.id",
        ].join(" "),
      };
    case "searchOyoBookContracts":
      return {
        name,
        limit: 500,
        sql: [
          "SELECT ocid, id, date, tender_title, tender_value_amount, tender_value_currency, buyer_name, tender_procuringEntity_name",
          "FROM states_pg.oyo_main",
          `WHERE ${OYO_TITLE_FILTER}`,
          "ORDER BY date DESC, id DESC",
        ].join(" "),
      };
    case "getNigeriaCpi":
      return {
        name,
        limit: 100,
        sql: [
          "SELECT date, value, indicator_id, indicator_name",
          "FROM states_pg.world_bank_cpi",
          "WHERE countryiso3code = 'NGA' AND value IS NOT NULL",
          "ORDER BY date ASC",
        ].join(" "),
      };
    case "getCrossPublisherSuppliers":
      return {
        name,
        limit: 50,
        sql: [
          "SELECT b.name AS supplier,",
          "count(DISTINCT b.main_ocid) AS bpp_awards,",
          "count(DISTINCT o.main_ocid) AS osun_awards",
          "FROM bpp_pg.bpp_awards_suppliers b",
          "JOIN states_pg.osun_awards_suppliers o ON upper(trim(b.name)) = upper(trim(o.name))",
          "GROUP BY b.name",
          "ORDER BY bpp_awards DESC",
        ].join(" "),
      };
  }
}

export function isKnownQueryTool(value: unknown): value is QueryToolName {
  return typeof value === "string" && [
    "searchFederalBookContracts",
    "getFederalBookContractItems",
    "getLeafMatchedComparison",
    "searchOyoBookContracts",
    "getNigeriaCpi",
    "getCrossPublisherSuppliers",
  ].includes(value);
}

export function buildToolSelectionPrompt(question: string, plan: string): string {
  return [
    "You are the Contract Trail data agent.",
    "Select only named typed tools. Never write SQL and never compute procurement numbers.",
    `Question: ${question}`,
    `Planner output: ${plan}`,
    "Return JSON only: {\"tools\":[...]} using only these names: searchFederalBookContracts, getFederalBookContractItems, searchOyoBookContracts, getNigeriaCpi, getCrossPublisherSuppliers, getLeafMatchedComparison.",
    "Choose the smallest set of tools that supports the plan. The defence critic can request getLeafMatchedComparison later.",
  ].join("\n");
}

export function toolNameList(): QueryToolName[] {
  return [
    "searchFederalBookContracts",
    "getFederalBookContractItems",
    "getLeafMatchedComparison",
    "searchOyoBookContracts",
    "getNigeriaCpi",
    "getCrossPublisherSuppliers",
  ];
}
