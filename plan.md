# Contract Trail: build plan

Event: Open Agent Hackathon 2026 (GenAI Works) · **Track 02, The Agent That Can Explain Why** · also entering **Best use of NVIDIA Nemotron** (DGX Spark).
Builder: solo, building with AI coding agents (Codex builds, Claude plans and reviews; the human runs things on the Mac, records and submits).
**Hard deadline: Tue 27 Oct 23:45 UTC = Wed 28 Oct 00:45 WAT.** Target submit: **Tue 27 Oct 22:00 WAT.**
Sources of truth (local only, never committed): `research/RULES.md` (rules), `research/SPIKE.md` (what's proven), `research/ECOSYSTEM.md`, `research/COMPARISON.md`.

---

## 1. Core loop
**Contract Trail investigates public procurement data for a journalist:**
- it federates federal and state Open Contracting (OCDS) records through Zetaris;
- it proposes red-flag leads, has a critic try to explain each one away, and returns only the leads that survive;
- each lead comes with the exact records, the arithmetic and what to verify on the ground.

## 2. The replayable case (everything is built around this)
**Amaka**, a procurement reporter at a Lagos newsroom (an illustrative persona, labelled as such), asks:
> *"Are the exercise-book contracts in federal constituency projects priced fairly compared with what states pay?"*

1. **Planner** (Nemotron Ultra) breaks the question into: find exercise-book purchases in each publisher → get quantities and values → compare price per book on a like-for-like basis → check for patterns.
2. **Data agent** (Nemotron Lightning, tool calls) runs parameterised queries **through Zetaris** across `bpp_pg` (federal BPP) and `states_pg` (Oyo, Osun). Every query, row count and timing goes into the trace.
3. **Classifier critic** throws out false matches. "Notebook ThinkPad" is a laptop, not a book. Contracts mixing books with other items are excluded from per-unit pricing.
4. **Deterministic engine** (plain code, never the model):
   - computes price per book;
   - deduplicates by OCID and latest release;
   - deflates to a common year using Nigeria CPI (World Bank series, queried through Zetaris);
   - checks the twin-award rule.
5. **Defence critic** (Nemotron Ultra) argues each lead's innocent explanation: inflation, different specs (leaves, hardcover, four-colour), distribution included, duplicate release. It either downgrades the lead, asks the data agent for one more query (at most 2 extra rounds), or lets it stand. **Withdrawn leads stay visible, with the reason.**
6. **Reporter** (Lightning) writes the lead list: each lead has severity, evidence rows (OCDS IDs linking to data.open-contracting.org), arithmetic, the critic's challenges and answers, and "what to verify on the ground". Wording is "lead to verify", never an accusation.
7. Amaka **dismisses** one lead ("price includes distribution to 40 schools; justified"). **H-MEM** stores her decision. On the next run, the dismissed lead is shown as *superseded by reporter decision*, not re-raised, and the critic cites the earlier decision.

**Ends better off:** in about 2 minutes, Amaka has a short ranked list of cited, pre-challenged leads. The current way is downloading spreadsheets per publisher and filtering by hand; Dataphyte's investigation describes that manual route. Expected leads (from the spike data):
- **Price gap:** federal 2023–24 books-only contracts at a median ₦2,059/book (range ₦1,051–₦2,849) against Oyo's ₦150–₦280 (2019–22). The lead only stands if the gap survives the CPI adjustment, and it's a lead either way.
- **Twin awards:** two federal contracts signed 2024-10-15, each for 8,200 books, valued ₦19,688,875 and ₦19,753,375.
- **Suppliers at both levels:** 7 suppliers won both federal and Osun awards. Context, not wrongdoing.

## 3. How a judge can check it
- **No live trigger.** By the rules, Zetaris and Nightshift must run locally on the builder's Mac (Nightshift's hotspot is local-only). Exposing either to the internet would be unsafe, and judges can't install Zetaris without its registry credentials.
- **Instead, three things:**
  1. **`SAMPLE_MODE=true`:** `npm run demo` replays recorded Zetaris responses and Nightshift outputs for the replayable case, with no services or keys. It's labelled "replayed" everywhere.
  2. **Public run records:** `runs/` holds the full JSON trace of at least 3 real runs on different days (SQL text, row counts, timings, model ID and receipt per call, critic rounds, final leads). A static **run viewer** is published on GitHub Pages (or a subdomain of ajkadri.dev).
  3. **Self-verification:** every lead's evidence links to its OCDS record on data.open-contracting.org, and its arithmetic is shown. A judge can check any number in under a minute.

## 4. Scope tiers
**Must ship (the entry fails without these):**
- Data: reproducible ingestion of BPP + Osun + Oyo into the `ct-pg` Postgres; two Zetaris data sources; all app reads go through the Zetaris REST API.
- Nigeria CPI available through Zetaris: a REST table if the gate passes, otherwise a Postgres table with the source cited.
- An agent loop with planner, data agent, classifier critic, defence critic and reporter; bounded rounds; a full trace.
- Deterministic rules **R1** (price per unit, deflated, by peer group) and **R2** (twin awards); **R3** (suppliers at both levels) as context.
- An **H-MEM** implementation passing the Meterless conformance suite, *plus* a feature test: a dismissed lead is superseded on rerun.
- Nightshift as the only model provider, with pinned Nemotron IDs and the model and receipt logged per call; a Lightning fallback when Ultra times out.
- Web UI: question box → live trace → lead cards with evidence, arithmetic, challenges and dismiss.
- `SAMPLE_MODE`, `runs/` with 3+ real traces, README, sponsor explanation.

**Only after the demo is recorded:**
- R4: repeat-winner concentration per buyer.
- Anambra as a third state.
- Run viewer polish.
- A Nemotron-vs-deterministic-only comparison table.
- A second replayable question (Osun supplier concentration).

**Never (this time):**
- Company-registry or beneficial-ownership checks (no open API; state this openly).
- Scraping portals.
- Accusatory scoring.
- Auth or multi-user.
- Deployment of a live backend.
- Model fine-tuning.

## 5. Milestones and acceptance checks (WAT)
A milestone is done only when its check has been **run and its output pasted**. A coding agent saying "done" doesn't count.

| # | Milestone | Done by | Acceptance check |
|---|---|---|---|
| M0 | Scaffold + reproducible data | **Sat 24, 23:00** | `docker compose -f infra/data-compose.yml up -d` starts `ct-pg` on `zetaris_default`; `npm run ingest` loads all tables, printing row counts (BPP awards 17,431; Osun awards 492; Oyo main 304); `npm run zetaris:register` is idempotent and `SHOW DATASOURCE TABLES` lists every table; `npm test` passes; `git status` shows no secret or data files |
| M1 | Hardest integrations | **Sun 25, 13:00** | (a) `npm run check:zetaris` runs the spike's cross-publisher supplier join from TypeScript and prints 7 rows; (b) `npm run check:nightshift` calls Lightning and Ultra, printing the *returned* model ID for each; (c) **CPI gate:** a World Bank `FP.CPI.TOTL` (NGA) REST table is queryable through Zetaris, otherwise fallback table + note; (d) **H-MEM:** `npm run conformance:hmem` passes the upstream suite, with the output pasted |
| M2 | **Core loop end to end, CLI** (midpoint target) | **Sun 25, 23:00** | `npm run ask -- "<Amaka's question>"` on real Zetaris + Nightshift returns at least 2 leads with evidence IDs, at least 1 critic challenge in the trace, and a trace file in `runs/`; total time under 4 min |
| M3 | Depth: rules, critics, memory | **Mon 26, 16:00** | Unit tests for R1, R2 and dedupe on fixtures (laptop "notebook" excluded; a duplicate release counted once; a deflation example by hand); the defence critic withdraws at least 1 lead with a reason; dismiss → rerun shows superseded (H-MEM feature test green); an Ultra timeout falls back to Lightning and is logged |
| M4 | UI | **Mon 26, 23:59** | `npm run dev`: question → streaming trace → lead cards → dismiss → rerun, all in the browser; a screenshot of every step saved to `docs/img/` |
| M5 | Proof pack | **Tue 27, 12:00** | `SAMPLE_MODE=true npm run demo` works on a fresh clone with no `.env`; `runs/` has 3+ real runs from different sessions; the run viewer is published and opens signed-out |
| — | **Packaging reserve starts** | **Tue 27, 12:45** | Building stops; only fixes from the judge audit |
| M6 | Submitted | **Tue 27, 22:00** | HackOS shows the entry submitted; the repo is public and tagged `submission`; the video is uploaded |

**Midpoint target:** M2 by **Sun 25, 23:00 WAT**. If it's not running by Mon 26 09:00, cut the UI to a minimal page and drop all second-tier items.

## 6. Time budget
- Build window from now (Sat 24, ~18:00 WAT) to the deadline is about 79 h.
- The reserve (about 15%, about 12 h) starts **Tue 27, 12:45 WAT**. It covers the judge audit (Mode 3), the README and page, the slide deck, the video (you record; script drafted by Claude) and the final check (Mode 5).

## 7. Claims → evidence
| Claim | Evidence |
|---|---|
| Amaka gets cited, pre-challenged leads in about 2 minutes instead of a manual spreadsheet trawl | A timed run in the video; trace timestamps; the Dataphyte manual method cited (GIJN) as the current way |
| The leads are correct, not just plausible | Every number is shown with its arithmetic and OCDS IDs, so a judge can open the source records |
| The agents genuinely challenge and revise | Trace: critic challenges, extra queries, withdrawn leads with reasons |
| Zetaris federates separate publishers live | Trace: SQL text against `bpp_pg.*` and `states_pg.*` in one query, row counts, timings |
| Memory changes behaviour across sessions | H-MEM conformance output plus the dismiss → rerun feature test, shown on screen |
| Nemotron does the reasoning | A model ID and Nightshift receipt for every call in `runs/`; no other provider configured |

## 8. Evidence labels (keep current)
| Part | Label |
|---|---|
| OCDS data | **Live through Zetaris**, from dated monthly snapshots (BPP retrieved Oct 2026) |
| Nigeria CPI | Live REST through Zetaris, *or* a cited snapshot table (decided in M1) |
| Agent reasoning | **Live** (Nemotron via Nightshift) in real runs; **replayed** in SAMPLE_MODE |
| Amaka | **Illustrative persona** |
| Company-registry / ownership checks | **Not built** (no open API) |
| Run viewer | **Replayed** real traces |

## 9. Deliverables map (HackOS form fields not yet seen; open the draft on Sunday)
| Deliverable | Owner | Source |
|---|---|---|
| Demo video, 1–4 min | You record; Claude scripts | Real run of the replayable case |
| Slide deck: problem and users, solution, agent workflow, stack, Zetaris and Meterless use, what's unique, visuals, next steps | Claude drafts; you review | Deck artifact → PDF |
| Public GitHub repo + README (setup, usage, dependencies) | Codex + Claude | This repo |
| Sponsor-tech explanation: Zetaris, which Meterless Engine plus its test, the Nightshift connection, where NVIDIA contributes, what's unique | Claude | `docs/SPONSORS.md` |
| Pre-existing components declared | You | None before 22 Oct; spike scripts written 24 Oct (inside the window); data from public registries |
| Track = 02; team = you (solo team on HackOS) | You | HackOS |
| Prize split | n/a (solo) | — |

## 10. Outside users
Goal: 1–2 people outside the team try it, or watch a run, by Monday night.
- Who: a Nigerian data or procurement journalist or civic-tech person (ICIR, Dataphyte, BudgIT, Premium Times data desk).
- How: you send a short DM on X or LinkedIn with a 60-second clip from M2. Claude drafts it.
- Attribution: quote feedback only with permission; never imply endorsement.

## 11. Sponsor prizes
- **Main:** Track 02.
- **Best use of Nemotron:** already in the main flow. Ultra plans and critiques, Lightning handles tools and the reporter, every call is logged, and Nemotron is shown changing outcomes (withdrawn leads).
- Nothing else applies.

## 12. Ethics and data rules
- Outputs are "leads to verify", with a visible disclaimer; never "fraud" or "corruption".
- Name companies only as they appear in the public records, with links.
- Credit the sources: OCDS data via the Open Contracting Partnership's registry (CC BY 4.0 unless noted); check BPP's licence at nocopo.bpp.gov.ng/license before publishing; World Bank data under CC BY 4.0.
