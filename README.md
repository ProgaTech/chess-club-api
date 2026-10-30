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
