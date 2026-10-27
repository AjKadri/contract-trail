# Contract Trail run records

The nine top-level JSON files are the curated proof pack from agent version 2.
They are real `LIVE` sessions, have all model calls at `status=ok`, contain no
retry calls, and finish in under 120 seconds. The static viewer reads only the
top-level curated records. The first run is also bundled as the default sample.

## Curated proof pack

- `2026-10-25T13-55-53-386Z-are-the-exercise-book-contracts-in-federal-const.json` — first run: price gap + twin award
- `2026-10-25T14-10-37-293Z-are-the-exercise-book-contracts-in-federal-const.json` — memory: twin superseded
- `2026-10-26T20-02-52-561Z-which-suppliers-won-contracts-from-both-the-fede.json` — cross-publisher suppliers
- `2026-10-26T20-03-21-074Z-are-any-federal-exercise-book-awards-suspiciousl.json` — similar federal awards
- `2026-10-25T14-01-45-223Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T14-04-17-406Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T14-07-54-186Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-26T09-51-57-644Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-26T20-01-55-382Z-are-the-exercise-book-contracts-in-federal-const.json`

## Development history

Earlier sessions, failed or retrying runs, dismissal-only decisions, and the
model probe are retained under `runs/dev-history/`. They are not included by
`npm run build:viewer`.

- `2026-10-24T17-39-08-272Z-are-the-exercise-book-contracts-in-federal-const-failed.json`
- `2026-10-24T17-41-43-713Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-24T17-44-50-513Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-24T17-48-09-821Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T12-34-38-115Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T12-40-10-714Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T12-40-18-238Z-dismiss-price-gap-federal-vs-oyo.json`
- `2026-10-25T12-44-58-077Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T12-52-00-394Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T13-30-32-100Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T13-31-35-001Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T13-58-45-934Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T13-59-29-713Z-are-the-exercise-book-contracts-in-federal-const.json`
- `2026-10-25T14-02-33-414Z-dismiss-twin-award-ocds-gyl66f-539001003.json`
- `2026-10-25T14-09-06-052Z-dismiss-twin-award-ocds-gyl66f-539001003.json`
- `probe-models-2026-10-25T13-28-56-980Z.json`
