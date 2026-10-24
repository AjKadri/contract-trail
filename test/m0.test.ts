import { describe, expect, it } from "vitest";

import { DATASET_TABLES, HEADLINE_COUNTS, TABLES_BY_DATABASE } from "../scripts/ingest/manifest.js";
import { buildTableLoadSql, quoteIdentifier } from "../scripts/ingest/sql.js";
import {
  EXPECTED_ZETARIS_TABLES,
  buildCreateDatasourceSql,
  buildRegisterTablesSql,
  buildShowTablesSql,
  sqlLiteral,
} from "../scripts/zetaris/sql.js";

describe("data manifest", () => {
  it("contains the eight procurement and CPI tables", () => {
    expect(DATASET_TABLES.map((entry) => `${entry.database}.${entry.table}`)).toEqual([
      "bpp.bpp_awards",
      "bpp.bpp_awards_suppliers",
      "bpp.bpp_contracts",
      "bpp.bpp_contracts_items",
      "states.osun_awards",
      "states.osun_awards_suppliers",
      "states.oyo_main",
      "states.oyo_tender_items",
      "states.world_bank_cpi",
    ]);
    expect(TABLES_BY_DATABASE.bpp).toHaveLength(4);
    expect(TABLES_BY_DATABASE.states).toHaveLength(5);
  });

  it("keeps the three M0 headline counts explicit", () => {
    expect(HEADLINE_COUNTS).toEqual({
      bpp_awards: 17_431,
      osun_awards: 492,
      oyo_main: 304,
    });
  });
});

describe("M0 generated SQL", () => {
  it("quotes identifiers and preserves the source path", () => {
    expect(quoteIdentifier("contract\"items")).toBe('"contract""items"');
    expect(buildTableLoadSql(DATASET_TABLES[0], ["id", "value_amount"])).toContain(
      "COPY \"bpp_awards\" FROM '/data/csv_64/full/awards.csv'",
    );
    expect(buildTableLoadSql(DATASET_TABLES[2], ["id", "dateSigned"])).toContain(
      "COPY \"bpp_contracts\" FROM '/data/csv_64/full/contracts.csv'",
    );
    expect(buildTableLoadSql(DATASET_TABLES[3], ["id", "quantity"])).toContain(
      "COPY \"bpp_contracts_items\" FROM '/data/csv_64/full/contracts_items.csv'",
    );
  });
});

describe("M0 Zetaris registration SQL", () => {
  it("uses the required datasource, registration, and show commands", () => {
    const create = buildCreateDatasourceSql(
      { name: "bpp_pg", description: "BPP federal OCDS", database: "bpp" },
      "p'ass",
    );
    expect(create).toContain("CREATE DATASOURCE bpp_pg");
    expect(create).toContain("jdbc:postgresql://ct-pg:5432/bpp");
    expect(create).toContain("password 'p''ass'");
    expect(buildRegisterTablesSql("bpp_pg")).toBe("REGISTER DATASOURCE TABLES FROM bpp_pg");
    expect(buildShowTablesSql("bpp_pg")).toBe("SHOW DATASOURCE TABLES bpp_pg");
    expect(EXPECTED_ZETARIS_TABLES.bpp_pg).toHaveLength(4);
    expect(EXPECTED_ZETARIS_TABLES.states_pg).toHaveLength(5);
    expect(sqlLiteral("O'Reilly")).toBe("'O''Reilly'");
  });
});
