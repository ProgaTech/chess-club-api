# Chess Club API

```sh
bun install
bun run dev
```

http://localhost:3000

Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env`.

Accounts are in Postgres. Start it with `docker compose up -d` and set `DATABASE_URL` in `.env`.

On Render, deploy with the Dockerfile. Set `DATABASE_URL` to the hosted database, not localhost. Set `CORS_ORIGINS` to the Netlify site URL.

## Roles

Every signed-in user is a `member`: they can view all pages and add Chess.com games to a match they play in. They are matched to the draw by their account name.

An `organizer` can do everything: generate rounds, save draws, and add games to any match. Yura is the organizer. Set their verified Clerk email in `ORGANIZER_EMAIL`.

Roles are checked on the server. Display names are never trusted, because any user can rename themselves to Yura.

## Test game analysis

Install the locked dependencies with `bun install --frozen-lockfile`. Run with Bun and Node.js 22+ on PATH. The Stockfish 18 Lite engine and its network are included in the stockfish package.

Generate a report directly from a finished PGN:

```sh
bun src/analyze-pgn.ts docs/sample-game.pgn report.md
```

For the web flow, start this API with the usual Clerk and Postgres configuration, then open **Analysis** in the UI. The API applies the analysis migration at startup and processes one job at a time per server. A member can also choose **Analyze game** on an eligible entry in **Me → Games**. Completed and failed jobs expire after seven days.
