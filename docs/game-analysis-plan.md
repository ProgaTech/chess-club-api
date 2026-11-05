# Finished-game analysis: implementation plan

Status: proposal, no runtime change. Companion: [UI delivery plan](https://github.com/ProgaTech/chess-club-ui/pull/6/files). First release: a signed-in member submits one finished standard game and receives a replayable engine review, followed by optional coaching for up to five turning points. Stockfish calculates; the model explains. A provider outage must never hide a completed engine review.

## 1. Establish the contract and test corpus (API + UI)

Extend the Bun/Hono service in src/index.ts. Reuse chess.js, the nullable PGN on chessGames in src/db/schema.ts, existing account authentication and actual game colors. Do not infer mover or winner from tournament seating. Keep submitted PGNs and generated reports private to their requester by default.

Proposed v1 endpoints (unprefixed, like existing routes):

| Request | Response / behavior |
| --- | --- |
| POST /analyses with exactly one of {pgn} or {gameId} | 202 {id,status}; return existing owned job/report on repeat submission. Check access to the referenced game. |
| GET /analyses/:id | {id,status,progress:{done,total},stage,report?,error?}; poll with backoff. Status: queued, running, ready, failed. Ready implies engine report exists; coaching has its own pending, ready, unavailable or disabled state. |
| DELETE /analyses/:id | 204; stop pending work and delete owned input/report/coaching. Do not delete the club game. |

Use stable error codes for unfinished_game, invalid_pgn, unsupported_variant, missing_pgn, quota_exceeded and analysis_failed. Return 401 for missing auth, 404 for inaccessible IDs, 413 for size, 422 for invalid input, 429 with retry delay for quotas. Bound bytes, plies and active jobs per user before costly work. Reject multiple games, illegal main lines, missing or ongoing results and conflicting header/movetext. Accept resignations and agreed draws in nonterminal positions. For manual PGNs require finished-game attestation: a result marker alone cannot establish provenance. No unrestricted FEN analysis or live-game endpoint.

Share a versioned JSON fixture in both repos before parallel implementation. Report v1: schemaVersion, engineProfile, startFen, result, moves[], criticalPlies[], summary and coachingStatus. A move contains ply (1-based from startFen), side, playedSan, playedUci, fenBefore, fenAfter, bestUci, scoreBefore/After ({cp} or {mate}, White perspective), winLossPp (mover perspective), classification, bestLineUci[], playedLineUci[] (both rooted before the move), motifs[], clockLeftSec or null. Include explicit nulls for unavailable evidence. Compare both clients to the same black-to-move custom-start fixture. Publish fixtures for ready-without-coaching, queued, retry and failure.

## 2. Build and benchmark the deterministic worker (backend)

1. Replay a single PGN main line including setup FEN through chess.js. Preserve move history for repetition, promotion, castling and en passant. Store normalized moves separately from untrusted headers/comments. Extract optional clock stamps; never infer elapsed time without the time-control, increment/delay semantics and adjacent clocks.
2. Package a pinned Stockfish binary and matching evaluation network in a separate worker image. Speak UCI over bounded subprocess I/O; wait for readiness, impose deadlines, kill/restart stuck processes. Begin with one thread per job, fixed nodes and bounded hash. Benchmark short, median and long club games on deployment hardware before choosing production limits. Capture p50/p95 latency, peak RSS and CPU-seconds per game.
3. Evaluate the best move and the played move from the same root with comparable budgets (restricted search for the played move when needed). Verify every principal variation by replay. Handle terminal positions and mate distances separately; never treat mate as a centipawn value. Normalize both scores to White once; compute mover loss as max(0, moverWinBest - moverWinPlayed) in percentage points. Choose and version a documented cp-to-probability curve and thresholds after reviewing fixtures for both colors. Do not claim parity with Chess.com accuracy.
4. Rank turning points by mover loss or a forced mate transition; select up to five distinct plies, allowing zero. Start with tested motifs only (e.g. a fork confirmed in the verified line). Unsupported labels stay absent. Report missing clocks/opening evidence honestly. Defer brilliant/only-move labels until alternatives and sacrifice compensation can be tested.

## 3. Persist and operate jobs (backend + operations)

Add Drizzle migrations for analysis jobs (owner, source, canonical input hash, profile, status, timestamps, progress, lease, attempts, error), versioned engine reports and separate coaching results. Unique ownership/input/profile key prevents duplicate submissions. Hash the normalized starting position, move history, result and evidence affecting the report (e.g. clocks). Use a Postgres job table with transactional claim/skip-locked, renewable leases and bounded retries before adding another queue service. Persist results atomically, fence stale workers and handle deletion during processing. Cache position work only with compatible engine build, network, limits, search constraints, rules and history; bypass reuse when draw history is uncertain. Do not cache by bare FEN across profiles.

Deploy API and worker separately. Needed: worker CPU/RAM limit, persistent Postgres, migration/recovery owner, retention period and cleanup schedule, per-member quotas and feature flags for engine and coaching. Measure queue age, failures, cache hits, job runtime and provider usage; exclude PGNs, prompts and tokens from logs. Disable new submissions and drain jobs on rollback; keep stored reports readable. Confirm packaging/redistribution obligations for the chosen binary, network and opening data before release.

## 4. Add grounded explanations (backend + chess reviewer)

Use one server-side model adapter with a configurable model ID; select a supported provider after a small quality/cost comparison. Needed: secret storage, spend ceiling, timeout, token budget and reviewed examples at novice and advanced levels. Send only structured evidence for selected plies, with stable fact and line IDs. Omit usernames and raw PGN comments. Request structured explanations, turning point and up to three lessons citing evidence IDs. Render moves/numbers from those IDs; reject unknown references and unsupported tactical claims. Fall back to templated engine facts on validation failure. Cache by report hash, prompt version, level and model. Human-review groundedness on a labeled sample before enabling prose.

## 5. Later increments, in dependency order

- Import completed Chess.com archives by username/date/time class, serialized per provider with contact User-Agent, bounded pages, cache/revalidation and 429 backoff. Use published game data, not scraped reviews. Deduplicate by platform game ID. Expand to Lichess after adding source-specific fixtures.
- Position Q&A accepts only an owned finished report, ply and candidate move. Validate legality there, evaluate the candidate under a bounded budget and explain the resulting verified line. No general-purpose live position tool.
- Enrich evidence: local ECO matching, phase breakdown, clock-pressure trends, verified tactical motifs and optional eligible Syzygy positions with timeout/fallback. Consider standalone FEN/screenshots only after defining provenance and fair-play controls.
- Batch jobs reuse the single-game worker. Aggregate by player, actual color, opening and phase; publish counts and minimum sample rules. Generate puzzles from verified unique solutions, then training plans, spaced repetition and progress trends. Rating-band comparisons require a suitable licensed baseline and comparable samples.

## Release gates

Backend owner: replay golden PGNs for Black mistakes, forced mates, repetitions, draws, resignation, promotions, setup FEN and absent clocks. Test worker death, concurrent submissions, lease expiry, isolation/deletion and provider failures. UI owner: consume ready/error fixtures and navigate to the same ply. Operations owner: demonstrate a bounded backlog on target hardware, set latency/spend limits from the benchmark and rehearse rollback. Chess reviewer: sign off classification thresholds and verify every displayed variation is legal. Pilot engine-only with a small club cohort, then enable coaching separately. First implementation ticket: agree on the fixtures and benchmark the worker; no model key is needed for either.
