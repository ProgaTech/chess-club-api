import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    name: text('name').notNull(),
    surname: text('surname').notNull(),
    chessCom: text('chess_com'),
    elo: integer('elo').notNull().default(1200),
    signupName: text('signup_name'),
  },
  (table) => [
    uniqueIndex('accounts_chess_com').on(sql`lower(${table.chessCom})`),
    uniqueIndex('accounts_signup_name').on(sql`lower(${table.signupName})`),
  ],
)

export const draws = pgTable('draws', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  result: jsonb('result').notNull(),
})

export const signups = pgTable(
  'signups',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    respondent: text('respondent').notNull(),
    level: text('level'),
    username: text('username'),
    timeControl: text('time_control'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('signups_name').on(sql`lower(${table.name})`)],
)

export const externalPlayers = pgTable(
  'external_players',
  {
    id: serial('id').primaryKey(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    externalUuid: text('external_uuid'),
    username: text('username').notNull(),
    countryName: text('country_name'),
    isComputer: boolean('is_computer'),
    accountId: integer('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('external_players_provider_external_id').on(table.provider, table.externalId),
    index('external_players_account_id').on(table.accountId),
  ],
)

export const chessGames = pgTable(
  'chess_games',
  {
    id: serial('id').primaryKey(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    externalUuid: text('external_uuid'),
    url: text('url'),
    status: text('status').notNull(),
    pace: text('pace'),
    result: text('result').notNull(),
    winnerColor: text('winner_color'),
    termination: text('termination').notNull(),
    terminationRaw: text('termination_raw'),
    terminationDetail: text('termination_detail'),
    rated: boolean('rated'),
    variant: text('variant'),
    variantName: text('variant_name'),
    timeClass: text('time_class'),
    initialSeconds: integer('initial_seconds'),
    incrementSeconds: integer('increment_seconds'),
    timeControlRaw: text('time_control_raw'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    plyCount: integer('ply_count'),
    eco: text('eco'),
    openingName: text('opening_name'),
    startingFen: text('starting_fen'),
    pgn: text('pgn'),
    encodedMoveList: text('encoded_move_list'),
    moveTimestamps: text('move_timestamps'),
    sourcePayload: jsonb('source_payload'),
    parserVersion: text('parser_version').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('chess_games_provider_external_id').on(table.provider, table.externalId),
    index('chess_games_ended_at').on(table.endedAt),
    index('chess_games_eco').on(table.eco),
    check('chess_games_status', sql`${table.status} in ('finished', 'ongoing', 'unknown')`),
    check('chess_games_result', sql`${table.result} in ('white_win', 'black_win', 'draw', 'unknown')`),
    check('chess_games_winner_color', sql`${table.winnerColor} is null or ${table.winnerColor} in ('white', 'black')`),
    check(
      'chess_games_pace',
      sql`${table.pace} is null or ${table.pace} in ('live', 'daily')`,
    ),
    check(
      'chess_games_time_class',
      sql`${table.timeClass} is null or ${table.timeClass} in ('bullet', 'blitz', 'rapid', 'daily')`,
    ),
  ],
)

export const chessGamePlayers = pgTable(
  'chess_game_players',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => chessGames.id, { onDelete: 'cascade' }),
    externalPlayerId: integer('external_player_id')
      .notNull()
      .references(() => externalPlayers.id),
    color: text('color').notNull(),
    username: text('username').notNull(),
    rating: integer('rating'),
    ratingChange: integer('rating_change'),
    ratingAfter: integer('rating_after'),
  },
  (table) => [
    uniqueIndex('chess_game_players_game_color').on(table.gameId, table.color),
    uniqueIndex('chess_game_players_game_player').on(table.gameId, table.externalPlayerId),
    index('chess_game_players_external_player_id').on(table.externalPlayerId),
    check('chess_game_players_color', sql`${table.color} in ('white', 'black')`),
  ],
)

export const analyses = pgTable('analyses', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  fingerprint: text('fingerprint').notNull(),
  input: jsonb('input').$type<import('../analysis-game').GameInput>().notNull(),
  status: text('status').notNull().default('queued'),
  done: integer('done').notNull().default(0),
  total: integer('total').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lease: timestamp('lease', { withTimezone: true }),
  markdown: text('markdown'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex('analyses_owner_fingerprint').on(table.owner, table.fingerprint),
  index('analyses_status_created').on(table.status, table.createdAt),
])
