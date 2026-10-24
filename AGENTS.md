# AGENTS.md: rules for coding agents on Contract Trail

Read `plan.md` first. It holds the milestones, acceptance checks and scope tiers. Work **one milestone at a time, in order**.

## Done means shown
- A task is done only when its acceptance check from `plan.md` has been **run** and you paste the command and its actual output.
- If a check can't run in your environment (Zetaris and Nightshift run on the user's Mac), say so and give the exact command for the user to run. Never claim a pass.
- Don't build anything the replayable case in `plan.md` §2 doesn't need. Check §4 (scope tiers) before adding features.

## Stack
- **App:** TypeScript, Node 20+, ESM. A small Fastify server plus a Vite + React UI. Tests with **vitest**.
- **Ingestion:** reuse and harden the Python spike (`spike/make_load_sql.py`, `spike/01_download.sh`) as `scripts/ingest/`, or port it to TypeScript; either is fine. It writes to Postgres directly. This is the **only** code allowed to touch Postgres directly.
- **Data store:** Postgres 16 container `ct-pg` on the Docker network `zetaris_default`, defined in `infra/data-compose.yml`. Databases: `bpp` (federal BPP OCDS) and `states` (Osun, Oyo). Optional CPI table.

## Sponsor rules (hard requirements; an entry without them is ineligible)
1. **Zetaris is the data layer.** At runtime the app reads data **only through the Zetaris REST API**:
   - `POST {ZETARIS_REST_URL}/sql-editor/sqls/run`;
   - headers `Authorization: Bearer`, `X-Org-ID`, and a fresh UUID in `X-Request-ID`;
   - body `{queryId, sql, source:"SqlEditor", limit}`.
   Reference implementation: `spike/zsql.py`. Data sources are `bpp_pg` and `states_pg`; tables are referenced as `<datasource>.<table>`. One SQL statement per call. Never connect the app to Postgres directly.
2. **Meterless Nightshift is the only model provider.**
   - Use the OpenAI-compatible client with base URL `METERLESS_BASE_URL`, key `METERLESS_RUNTIME_TOKEN`, and headers `meterless-app: contract-trail` and `meterless-scope: user`.
   - **Pin model IDs from env:** `METERLESS_FAST_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b`, `METERLESS_DEEP_MODEL=nvidia/nemotron-3-ultra-550b-a55b`. Never `meterless/auto`.
   - Ultra calls get a timeout (default 60 s), then **one** retry on Lightning, logged as a fallback.
   - Nemotron 3 Super and 3.5 Super VL do **not** work through this Nightshift; don't use them.
3. **At least one Meterless Engine in a working feature: H-MEM.**
   - Implement it from the upstream spec (`https://github.com/Meterless/Meterless`, `engines/hmem`). Clone it into `vendor/meterless/`, which is gitignored; check its licence and note it in the README.
   - Put the implementation in `src/engines/hmem/`. The upstream conformance suite must pass: `HMEM_IMPL=$PWD/src/engines/hmem/index.ts npx tsx vendor/meterless/engines/hmem/conformance/runner.ts`, exposed as `npm run conformance:hmem`.
   - **Watch upstream issue #3:** a declared `supersedes` must cause `supersededBy` and penalise the replaced record. Our dismiss feature depends on it, so add our own test.
4. **Log every model call:** requested model, **returned** model, latency, tokens if given, and any Nightshift receipt or run ID, written into the run trace.

## Agent design rules
- Roles: **Planner** (deep), **Data agent** (fast, tool calls only), **Classifier critic** (fast), **Defence critic** (deep), **Reporter** (fast). Bounded: at most 2 extra critic→data rounds per lead, and at most 30 model calls per run.
- **The model never computes numbers or decides matches on its own.** These are deterministic TypeScript with unit tests:
  - price per unit;
  - CPI deflation;
  - dedupe (OCID + latest release);
  - the twin-award rule (same quantity, same signed date, value within 1%);
  - supplier-name normalisation.
- **The data agent can't write free SQL.** It calls typed tools that fill vetted SQL templates (search purchases by keyword and publisher, get contract items, get supplier awards, get CPI). The templates live in `src/data/queries.ts`.
- Every run writes a JSON trace to `runs/<timestamp>-<slug>.json`: the question, plan, each tool call with its SQL, row count and timing, each model call (§ sponsor rule 4), critic challenges, withdrawn leads with reasons, final leads, and memory reads and writes.
- **Wording:** leads are "leads to verify". Never write "fraud", "corruption" or "stolen" in generated output. Show the disclaimer in the UI and README.
- **`SAMPLE_MODE=true`** replays a recorded trace: Zetaris responses plus model outputs, with no network, services or `.env` needed. Mark replayed output visibly as **REPLAYED**.

## Folder rules
- **Never edit or read secrets from `zetaris-platform/`.** It's the vendor platform and its `.env` holds admin credentials.
- **`research/` is local strategy material.** You may read `research/SPIKE.md` and `research/RULES.md`, but never copy them into the repo, quote them in public docs, or commit them (they're gitignored).
- `spike/` is throwaway reference code. Port what you need; don't build on it in place.
- `spike/data/` and any downloaded data are gitignored. Ingestion downloads fresh copies from data.open-contracting.org.
- Planned layout:
  - `src/` with `agents/`, `data/`, `engines/hmem/`, `rules/`, `llm/` and `server/`;
  - `web/`, `scripts/`, `infra/`, `runs/`, `docs/` and `test/`.

## Secrets
- Secrets live only in `.env`, which is gitignored. Keep `.env.example` current, with placeholders only.
- Never print keys in logs or traces; redact the `Authorization` header.
- Before any commit, check `git status` and `git diff --cached` for keys.

## Hardware
- A 16 GB Mac that's already under memory pressure, with Zetaris taking 8 GB of Docker memory. Don't add heavy local services or local models. Keep `ct-pg` small (alpine).

## Commands (keep working at every milestone)
- `npm test`
- `npm run ingest`
- `npm run zetaris:register`
- `npm run check:zetaris`
- `npm run check:nightshift`
- `npm run conformance:hmem`
- `npm run ask -- "<question>"`
- `npm run dev`
- `SAMPLE_MODE=true npm run demo`
