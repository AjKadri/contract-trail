# Contract Trail live setup

This setup runs the live case on a Mac with Zetaris and Nightshift available
locally. The app reads procurement data through Zetaris. Only the ingestion
scripts write directly to Postgres.

## Requirements

- macOS with Docker Desktop
- Node.js 20 or newer and npm
- A local Zetaris 2.4.3 installation, running on `localhost:8888`
- A local Meterless Nightshift installation, running on `127.0.0.1:8088`
- Zetaris registry credentials and a Nightshift runtime token

Start Zetaris and Nightshift using their local installation instructions before
starting the data container. The Zetaris installation must create the external
Docker network named `zetaris_default`. Keep Zetaris platform credentials out
of this repository.

## Clone and install

```sh
git clone https://github.com/AjKadri/contract-trail.git
cd contract-trail
npm ci
```

Create the local environment file. It is ignored by Git.

```sh
cp .env.example .env
```

Set the values in `.env`:

```dotenv
ZETARIS_REST_URL=http://localhost:8888/api/v1.0
ZETARIS_ORG_ID=1
ZETARIS_API_KEY=<your Zetaris API key>
METERLESS_BASE_URL=http://127.0.0.1:8088/v1
METERLESS_RUNTIME_TOKEN=<your Nightshift runtime token>
METERLESS_FAST_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
METERLESS_DEEP_MODEL=nvidia/nemotron-3-ultra-550b-a55b
METERLESS_EMBED_MODEL=nvidia/nemotron-3-embed-1b
CT_PG_PASSWORD=<local Postgres password>
SAMPLE_MODE=false
```

## Install the H-MEM reference source

The upstream conformance runner is used locally and is not committed because
`vendor/` is ignored. The upstream repository is Apache-2.0 licensed.

```sh
mkdir -p vendor
git clone https://github.com/Meterless/Meterless.git vendor/meterless
test -f vendor/meterless/LICENSE
```

If `vendor/meterless` already exists, keep it and confirm that the license file
is present. Do not put credentials in the vendor checkout.

## Start Postgres and load the public snapshots

Start Zetaris first so its external network exists, then use the project script
for the data container. Do not use the bare compose command.

```sh
npm run db:up
npm run ingest
```

`npm run ingest` downloads the public BPP, Osun, Oyo and World Bank CPI
snapshots when they are not already present, loads them into `ct-pg`, and
prints the row counts.

Register the Postgres tables with Zetaris:

```sh
npm run zetaris:register
```

The registration is safe to repeat. It creates or reuses `bpp_pg` and
`states_pg`, then checks the expected tables with `SHOW DATASOURCE TABLES`.

## Run the live checks

Run the checks with Zetaris and Nightshift still running:

```sh
npm run check:zetaris
npm run check:cpi
npm run check:nightshift
npm run conformance:hmem
npm test
npm run typecheck
```

The CPI check first tries the World Bank REST table. The current Zetaris
response parser cannot consume the World Bank top-level `[meta, data]` array, so
the accepted fallback is `states_pg.world_bank_cpi` populated by ingestion.

## Start the live app

```sh
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite UI proxies API requests to the Fastify
server at `http://127.0.0.1:3001`.

Ask Amaka's replayable question:

```sh
npm run ask -- "Are the exercise-book contracts in federal constituency projects priced fairly compared with what states pay?"
```

Each live run writes a full trace to `runs/`. The UI and CLI use Zetaris for
data access and Nightshift for all model calls. Model request or receipt IDs,
returned model IDs, timings and critic activity are recorded in the trace.

## H-MEM conformance command

The command used by the project is:

```sh
npm run conformance:hmem
```

It runs the upstream suite with the local implementation at
`src/engines/hmem/index.ts`.

## Replay without services

For the service-free demo, use a recorded trace instead of the live setup:

```sh
SAMPLE_MODE=true npm run demo
```

This path does not require `.env`, Docker, Zetaris or Nightshift and marks the
output as `REPLAYED`.
