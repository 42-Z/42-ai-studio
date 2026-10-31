import { bigint, boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Пользователи сервиса. Из этой таблицы вырастет вход (#4).
 *
 * Соглашения: таблицы во множественном числе в `snake_case`, первичные ключи —
 * uuid, время — `timestamptz`; у таблиц с данными пользователя есть внешний ключ
 * на `users(id)` или будущую `app_sessions(id)` с `ON DELETE CASCADE`.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Telegram ID помещается в 53 бита, поэтому в схеме — `number`. */
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  name: text("name").notNull(),
  username: text("username"),
  photoUrl: text("photo_url"),
  isOperator: boolean("is_operator").notNull().default(false),
  isBlocked: boolean("is_blocked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/**
 * Серверные сессии входа. В базе лежит только SHA-256 токена из cookie,
 * поэтому утечка таблицы не даёт готовых cookie.
 */
export const authSessions = pgTable("auth_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Одноразовые nonce для popup-входа. В базе лежит SHA-256 значения:
 * строка удаляется при первом использовании, поэтому повторная пара
 * «nonce + id_token» уже не пройдёт.
 */
export const loginNonces = pgTable("login_nonces", {
  id: uuid("id").primaryKey().defaultRandom(),
  nonceHash: text("nonce_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type LoginNonce = typeof loginNonces.$inferSelect;
