import { isAlreadyExists, runZetarisSql, rows } from "./client.js";
import {
  buildCreateCpiRestDatabaseSql,
  buildFallbackCpiQuerySql,
  buildRegisterCpiRestTableSql,
  buildRestCpiQuerySql,
} from "./cpi.js";

async function tryRestCpi(): Promise<void> {
  try {
    await runZetarisSql(buildCreateCpiRestDatabaseSql());
    console.log("[check:cpi] created World Bank REST Lightning database");
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    console.log("[check:cpi] World Bank REST Lightning database already exists");
  }

  try {
    await runZetarisSql(buildRegisterCpiRestTableSql());
    console.log("[check:cpi] registered World Bank FP.CPI.TOTL REST table");
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    console.log("[check:cpi] World Bank FP.CPI.TOTL REST table already exists");
  }

  const result = await runZetarisSql(buildRestCpiQuerySql(), 5);
  const resultRows = rows(result);
  if (resultRows.length < 1) {
    throw new Error("World Bank REST table returned no non-null Nigeria CPI row");
  }
  console.log(`[check:cpi] REST PASS rows=${resultRows.length} sample=${JSON.stringify(resultRows[0])}`);
}

async function fallbackCpi(): Promise<void> {
  const result = await runZetarisSql(buildFallbackCpiQuerySql(), 5);
  const resultRows = rows(result);
  if (resultRows.length < 1) {
    throw new Error("fallback states_pg.world_bank_cpi returned no non-null CPI row");
  }
  console.log(`[check:cpi] FALLBACK PASS rows=${resultRows.length} sample=${JSON.stringify(resultRows[0])}`);
  console.log("[check:cpi] source=World Bank FP.CPI.TOTL, Nigeria (NGA), fetched by scripts/ingest");
}

async function main(): Promise<void> {
  try {
    await tryRestCpi();
  } catch (error) {
    console.log(`[check:cpi] REST gate unavailable: ${error instanceof Error ? error.message : String(error)}`);
    await fallbackCpi();
  }
}

main().catch((error: unknown) => {
  console.error(`[check:cpi] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
