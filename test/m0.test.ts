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

describe("M0 data manifest", () => {
  it("contains the six replayable-case tables", () => {
    expect(DATASET_TABLES.map((entry) => `${entry.database}.${entry.table}`)).toEqual([
      "bpp.bpp_awards",
      "bpp.bpp_awards_suppliers",
      "states.osun_awards",
      "states.osun_awards_suppliers",
      "states.oyo_main",
      "states.oyo_tender_items",
    ]);
    expect(TABLES_BY_DATABASE.bpp).toHaveLength(2);
    expect(TABLES_BY_DATABASE.states).toHaveLength(4);
  });

  it("keeps the three M0 headline counts explicit", () => {
    expect(HEADLINE_COUNTS).toEqual({
      bpp_awards: 17_431,
      osun_awards: 492,
      oyo_main: 330,
    });
  });
});

describe("M0 generated SQL", () => {
  it("quotes identifiers and preserves the source path", () => {
    expect(quoteIdentifier("contract\"items")).toBe('"contract""items"');
    expect(buildTableLoadSql(DATASET_TABLES[0], ["id", "value_amount"])).toContain(
      "COPY \"bpp_awards\" FROM '/data/csv_64/full/awards.csv'",
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
    expect(EXPECTED_ZETARIS_TABLES.states_pg).toHaveLength(4);
    expect(sqlLiteral("O'Reilly")).toBe("'O''Reilly'");
  });
});
