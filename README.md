# Contract Trail

> **Leads, not accusations.** Contract Trail surfaces patterns in public procurement records that deserve a closer look. Every lead is something to verify, not a finding of wrongdoing.

Contract Trail helps investigative journalists turn scattered public procurement data into a short list of **cited, pre-challenged leads**. It works across federal and state Open Contracting (OCDS) publishers, starting with Nigeria.

_Work in progress for the Open Agent Hackathon 2026 (Track 02, The Agent That Can Explain Why). Full walkthrough, architecture and verification steps to come._

## Status
M0 scaffold is in place. The reproducible data path uses a small Postgres 16 Alpine
container on the existing `zetaris_default` Docker network. The app will read this
data through Zetaris, not directly from Postgres.

See `plan.md` for milestones and the exact acceptance checks.

## M0 setup

Copy `.env.example` to `.env` and set `CT_PG_PASSWORD`. Zetaris must already be
running so that the `zetaris_default` Docker network exists. Then run:

```sh
docker compose -f infra/data-compose.yml up -d
npm install
npm run ingest
npm run zetaris:register
npm test
```

`npm run ingest` downloads missing OCDS archives into the ignored `spike/data/`
directory, loads the six M0 tables, and prints their row counts. The headline
counts are BPP awards 17,431, Osun awards 492, and Oyo main 330.

## Data sources
- Open Contracting Data Registry (Open Contracting Partnership): Nigeria Bureau of Public Procurement, Osun State, Oyo State. Licence notes to be confirmed per publisher.
- World Bank: Nigeria consumer price index (FP.CPI.TOTL), CC BY 4.0.

## Licence
MIT (code). Data remains under its publishers' licences.
