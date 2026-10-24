import { WORLD_BANK_CPI_SOURCE_URL } from "../ingest/manifest.js";

export const CPI_REST_DATASOURCE = "world_bank_rest";
export const CPI_REST_TABLE = "world_bank_cpi";
export const CPI_FALLBACK_TABLE = "world_bank_cpi";

export function buildCreateCpiRestDatabaseSql(): string {
  return `CREATE LIGHTNING DATABASE ${CPI_REST_DATASOURCE} DESCRIBE BY 'World Bank REST API' OPTIONS ()`;
}

export function buildRegisterCpiRestTableSql(): string {
  return [
    `CREATE LIGHTNING REST TABLE ${CPI_REST_TABLE} FROM ${CPI_REST_DATASOURCE}`,
    `REQUEST (endpoint \"${WORLD_BANK_CPI_SOURCE_URL}\", method \"GET\", response_type \"JSON\")`,
    "HEADER ()",
    "BODY ()",
  ].join(" ");
}

export function buildRestCpiQuerySql(): string {
  return `SELECT date, value FROM ${CPI_REST_DATASOURCE}.${CPI_REST_TABLE} WHERE countryiso3code = 'NGA' AND value IS NOT NULL ORDER BY date DESC LIMIT 1`;
}

export function buildFallbackCpiQuerySql(): string {
  return `SELECT date, value FROM states_pg.${CPI_FALLBACK_TABLE} WHERE value IS NOT NULL ORDER BY date DESC LIMIT 1`;
}
