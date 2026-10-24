import { runZetarisSql, rows } from "./client.js";

const SUPPLIER_JOIN_SQL = `
SELECT b.name AS supplier,
       count(DISTINCT b.main_ocid) AS bpp_awards,
       count(DISTINCT o.main_ocid) AS osun_awards
FROM bpp_pg.bpp_awards_suppliers b
JOIN states_pg.osun_awards_suppliers o
  ON upper(trim(b.name)) = upper(trim(o.name))
GROUP BY b.name
ORDER BY bpp_awards DESC`;

async function main(): Promise<void> {
  const result = await runZetarisSql(SUPPLIER_JOIN_SQL, 50);
  const resultRows = rows(result);
  if (resultRows.length !== 7) {
    throw new Error(`expected 7 cross-publisher suppliers, got ${resultRows.length}`);
  }

  console.log(`[check:zetaris] cross-publisher supplier join rows=${resultRows.length}`);
  for (const row of resultRows) {
    console.log(`[check:zetaris] ${JSON.stringify(row)}`);
  }
}

main().catch((error: unknown) => {
  console.error(`[check:zetaris] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
