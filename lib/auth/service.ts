/**
 * Серверная часть входа: строки `auth_sessions` и пользователи.
 * Модуль не знает про Next.js и работает и в приложении, и в процессе eve.
 */
import { and, eq, lte } from "drizzle-orm";

import { getDb } from "../db/client";
import { authSessions, users, type NewUser, type User } from "../db/schema";
import { createSessionToken, hashSessionToken } from "./token";

/** `last_seen_at` обновляется не чаще раза в 5 минут. */
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

export interface TelegramProfile {
  /** Telegram ID из claim `id`. */
  telegramId: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
}

export interface TelegramLoginResult {
  user: User;
  blocked: boolean;
}

/** Ищет пользователя по токену cookie; просроченные строки не работают. */
export async function getUserBySessionToken(token: string): Promise<User | null> {
  if (token.length === 0) return null;
  const db = getDb();
  const tokenHash = hashSessionToken(token);

  const [row] = await db
    .select({
      user: users,
      sessionId: authSessions.id,
      expiresAt: authSessions.expiresAt,
      lastSeenAt: authSessions.lastSeenAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);

  if (row === undefined) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await db.delete(authSessions).where(eq(authSessions.id, row.sessionId));
    return null;
  }

  if (now - row.lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS) {
    await db
      .update(authSessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(authSessions.id, row.sessionId));
  }

  return row.user;
}

/**
 * Создаёт сессию входа и возвращает токен для cookie. Перед вставкой удаляет
 * просроченные строки этого пользователя.
 */
export async function createUserSession(userId: string, ttlDays: number): Promise<string> {
  const db = getDb();
  const now = new Date();

  await db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), lte(authSessions.expiresAt, now)));

  const token = createSessionToken();
  await db.insert(authSessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000),
    lastSeenAt: now,
  });
  return token;
}

/** Удаляет строку сессии; отсутствие строки — не ошибка. */
export async function deleteUserSession(token: string): Promise<void> {
  if (token.length === 0) return;
  await getDb()
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, hashSessionToken(token)));
}

/**
 * Находит или создаёт пользователя по профилю Telegram. Заблокированному
 * ничего не обновляется: вход для него закрыт, но строка остаётся.
 */
export async function upsertTelegramUser(profile: TelegramProfile): Promise<TelegramLoginResult> {
  const existing = await findUserByTelegramId(profile.telegramId);
  if (existing !== undefined) {
    return updateLogin(existing, {
      name: profile.name,
      username: profile.username,
      photoUrl: profile.photoUrl,
    });
  }

  const created = await insertUser({
    telegramId: profile.telegramId,
    name: profile.name,
    username: profile.username,
    photoUrl: profile.photoUrl,
    lastLoginAt: new Date(),
  });
  return { user: created, blocked: false };
}

/**
 * Локальный вход без Telegram. Существующему пользователю меняет только имя
 * и время входа: `username` и `photo_url` из настоящего Telegram не стираются.
 */
export async function upsertLocalUser(input: {
  telegramId: number;
  name: string;
}): Promise<TelegramLoginResult> {
  const existing = await findUserByTelegramId(input.telegramId);
  if (existing !== undefined) return updateLogin(existing, { name: input.name });

  const created = await insertUser({
    telegramId: input.telegramId,
    name: input.name,
    username: null,
    photoUrl: null,
    lastLoginAt: new Date(),
  });
  return { user: created, blocked: false };
}

async function findUserByTelegramId(telegramId: number): Promise<User | undefined> {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  return user;
}

async function insertUser(values: NewUser): Promise<User> {
  const [created] = await getDb().insert(users).values(values).returning();
  return created;
}

async function updateLogin(
  existing: User,
  fields: Pick<NewUser, "name" | "username" | "photoUrl">,
): Promise<TelegramLoginResult> {
  if (existing.isBlocked) return { user: existing, blocked: true };

  const [updated] = await getDb()
    .update(users)
    .set({ ...fields, lastLoginAt: new Date() })
    .where(eq(users.id, existing.id))
    .returning();
  return { user: updated, blocked: false };
}

/** Помечает пользователя оператором: локальный dev-вход и будущая админка. */
export async function grantOperator(userId: string): Promise<User> {
  const [updated] = await getDb()
    .update(users)
    .set({ isOperator: true })
    .where(eq(users.id, userId))
    .returning();
  return updated;
}
