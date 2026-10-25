# Sponsor technology in Contract Trail

## Zetaris: the data layer (required)
- **Local Docker install** of the Zetaris hackathon platform (2.4.3).
- **Two JDBC data sources over Postgres** (`infra/data-compose.yml`, container `ct-pg` on the `zetaris_default` network), registered by `scripts/zetaris/register.ts`:
  - `CREATE DATASOURCE bpp_pg … jdbcurl 'jdbc:postgresql://ct-pg:5432/bpp'`: federal BPP awards, suppliers, contracts and contract items.
  - `CREATE DATASOURCE states_pg … 'jdbc:postgresql://ct-pg:5432/states'`: Osun awards and suppliers, Oyo tenders and items, and the World Bank CPI.
  - `REGISTER DATASOURCE TABLES FROM <ds>`, then checked with `SHOW DATASOURCE TABLES`.
- **At runtime the app reads data only through Zetaris:** `POST /api/v1.0/sql-editor/sqls/run`, with a bearer API key, `X-Org-ID` and a fresh `X-Request-ID` (`src/data/queries.ts`). The app has no direct database client.
- **Federation:** the cross-publisher supplier query joins `bpp_pg.bpp_awards_suppliers` with `states_pg.osun_awards_suppliers` in one Zetaris SQL statement. `npm run check:zetaris` prints its 7 rows.
- **REST attempt:** we registered the World Bank CPI API as a Lightning REST table (`CREATE LIGHTNING REST TABLE`, with the request options copied from Zetaris's getting-started PokéAPI recipe). Registration succeeded, but queries returned `_corrupt_record`, because the API's top-level `[meta, data]` array isn't parsed. We kept a cited CPI snapshot in `states_pg` and documented the attempt in `npm run check:cpi`.

## Meterless Engine: H-MEM (required, at least one)
- **Implementation:** `src/engines/hmem/` (10 files), built from the upstream [Meterless H-MEM spec](https://github.com/Meterless/Meterless/tree/main/engines/hmem).
- **Test:** `npm run conformance:hmem`, the **unmodified upstream conformance runner**: **13/13 checks pass.**
- **Working feature:** when a reporter dismisses a lead (`Dismiss` in the UI, or `npm run ask -- --dismiss <leadId> "<reason>"`), the decision is written as a memory that **supersedes** the earlier lead memory. On the next run the lead shows as *superseded by reporter decision* and the critic cites it. Our implementation also fixes upstream issue [#3](https://github.com/Meterless/Meterless/issues/3): a declared `supersedes` now sets `supersededBy` and penalises the replaced record. A regression test covers it.

## Meterless Nightshift: the primary AI provider (required)
- The **only** model provider (`src/llm/nightshift.ts`): the OpenAI-compatible Runtime at `METERLESS_BASE_URL`, with headers `Authorization: Bearer <runtime token>`, `meterless-app: contract-trail` and `meterless-scope: user`.
- **Pinned models**, never `meterless/auto`: `nvidia/nemotron-3-ultra-550b-a55b` (deep) and `nvidia/nemotron-3.5-lightning-30b-a3b` (fast). `npm run check:nightshift` prints the requested and returned model for each.
- For every call the trace records the role, requested model, **returned** model, latency and Nightshift request ID. Ultra calls have a timeout and fall back once to Lightning, logged (covered by `test/nightshift.test.ts`).
- Reliability tuning was measured, not guessed. `npm run probe:models` ran 10 calls per role per configuration; the chosen setting (4,096 tokens, reasoning trace off) had 0 empty replies in 10 for every role.

## NVIDIA Nemotron: where it does the work
| Role | Model | What it decides |
|---|---|---|
| Planner | Ultra 550B | Breaks the question into typed tool steps |
| Data agent | Lightning 30B | Picks the query tools and parameters |
| Classifier critic | Lightning 30B | Challenges evidence quality (e.g. laptop "notebooks", mixed contracts) |
| Defence critic | Ultra 550B | Argues the innocent explanation; **requests extra queries**; sets *stand / downgrade / withdraw* |
| Reporter | Lightning 30B | Writes the lead cards |

Nemotron changes outcomes: in the recorded runs, the defence critic's request for a leaf-matched comparison re-scores the price-gap lead from HIGH to MEDIUM. Numbers are never produced by the model; every figure comes from tested code.

## What's unique
- Zetaris federates **separate government publishers** live, so no merge pipeline is needed. The agent adds critique *on top of* federation: a lead survives only after a critic has tried to explain it away and the data has been re-queried.
- H-MEM gives the investigation **institutional memory**: a reporter's verdict carries over to the next session.
