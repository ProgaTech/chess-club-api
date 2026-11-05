# V1 implementation plan — Stockfish Markdown download

A member submits a finished game, downloads a self-contained Markdown report and can attach it to a language model of their choice. The application needs Stockfish, chess.js, a background worker and the existing Bun/Hono, Clerk and Postgres stack.

## API and jobs

- POST /analyses accepts either an authorized saved gameId or pasted pgn plus finishedConfirmed. Validate a single legal standard game, consistent finished result, size and ply limits. Accept resignations, draws and custom starting FEN. Return 202 JSON with id and status.
- GET /analyses/:id returns queued, running, ready or failed, progress in plies and a stable error code on failure.
- GET /analyses/:id/report.md returns the complete raw UTF-8 file with Content-Type: text/markdown; charset=utf-8, Content-Disposition: attachment; filename="chess-analysis-<id>.md" and Cache-Control: private, no-store. Return 409 until ready, 401 on missing authentication and 404 for inaccessible jobs. Enforce owner checks on all routes. Repeated downloads read stored bytes.
- Use Drizzle to persist owner, input hash, engine and report versions, lease, attempts, progress and Markdown. Deduplicate submissions per owner and configuration. Bound worker concurrency, job duration and retries. Publish the file and ready state atomically.

## Engine analysis

Replay the main line with chess.js, preserving the actual side to move and history. Use a pinned Stockfish binary and its evaluation network over UCI. Compare best and played moves at each root with a fixed node budget, forcing the played move in a second search when necessary. Verify exported continuations by replay. Normalize evaluations to White's perspective. Rank critical moments by adverse mate transitions and evaluation loss for the mover. Calibrate the threshold with sample games so quiet games may have zero highlights.

## Markdown format

1. Include the format version, result, starting FEN, full numbered main line in SAN and engine build/search budget. Use normalized chess values and omit names, URLs, free-form headers and comments.
2. Explain the score convention. Positive favors White, negative favors Black. Use pawn units and identify the mating side for forced mates.
3. List up to five critical moments. For each, include move number, side, FEN before play, played move, best move, both evaluations and short verified lines starting from the same position. Distinguish engine continuations from the actual game.
4. Add a compact move-by-move table with played move, engine choice and both scores.
5. End with a prompt ready to copy: “Explain the critical moments using these scores and lines. Cite move numbers. Say when the report lacks evidence.”

## Release sequence

Agree with the UI on a sample PGN, status fixtures and expected .md before implementing the worker. Benchmark the pinned engine on deployment hardware to choose CPU, RAM and time limits. Define quotas, retention and cleanup. Verify Black-to-move starts, promotions, mates, resignations and quiet draws. Test lease recovery, owner isolation and identical repeat downloads. Accept v1 when a member can download a real completed game's file and reconstruct its critical positions using the file alone.
