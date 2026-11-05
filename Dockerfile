FROM node:22-bookworm-slim AS engine_runtime
FROM oven/bun:1
COPY --from=engine_runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY drizzle ./drizzle

ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "src/index.ts"]
