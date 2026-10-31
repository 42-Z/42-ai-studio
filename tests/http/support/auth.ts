/**
 * Помощники входа для HTTP-тестов: готовая сессия в базе и проход
 * popup-входа через тестовый издатель OIDC.
 */
import { eq } from "drizzle-orm";

import { SESSION_COOKIE } from "../../../lib/auth/cookies";
import { createSessionToken, hashSessionToken } from "../../../lib/auth/token";
import type { User } from "../../../lib/db/schema";
import { authSessions, users } from "../../../lib/db/schema";
import { fetchApp } from "./app";
import { cookiePair } from "./cookies";
import { db } from "./db";
import { DEFAULT_PROFILE, type TelegramProfile } from "./oidc-issuer";
import { telegramStub } from "./telegram";

export interface LoginAsOptions {
  /** Создать просроченную сессию: она ведёт себя как отсутствующая. */
  expired?: boolean;
}

/** Вставляет строку `auth_sessions` и возвращает заголовок `Cookie`. */
export async function loginAs(user: User, options: LoginAsOptions = {}): Promise<string> {
  const token = createSessionToken();
  const now = Date.now();

  await db()
    .insert(authSessions)
    .values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: new Date(now - 60 * 60 * 1000),
      expiresAt: new Date(
        options.expired === true ? now - 60 * 1000 : now + 30 * 24 * 60 * 60 * 1000,
      ),
      lastSeenAt: new Date(now - 60 * 60 * 1000),
    });

  return `${SESSION_COOKIE}=${token}`;
}

export interface StartedTelegramLogin {
  nonceResponse: Response;
  nonce: string;
  nonceToken: string;
}

/** Первый шаг popup-входа: nonce и подписанный токен для callback. */
export async function beginTelegramLogin(): Promise<StartedTelegramLogin> {
  const nonceResponse = await fetchApp("/api/auth/telegram/nonce", { method: "POST" });
  const body = (await nonceResponse.json()) as { nonce?: unknown; token?: unknown };
  if (typeof body.nonce !== "string" || typeof body.token !== "string") {
    throw new Error("сервер не вернул nonce и токен");
  }
  return { nonceResponse, nonce: body.nonce, nonceToken: body.token };
}

export interface LoginViaTelegramResult {
  steps: Response[];
  cookie: string | null;
  user: User | null;
}

/**
 * Проходит вход целиком: nonce → тестовый издатель → callback.
 * Профиль задаётся через `telegramStub`; порчу токена тесты выставляют сами.
 */
export async function loginViaTelegram(
  profile: TelegramProfile = DEFAULT_PROFILE,
): Promise<LoginViaTelegramResult> {
  await telegramStub.setProfile(profile);

  const start = await beginTelegramLogin();
  const idToken = await telegramStub.idTokenFor(start.nonce);

  const callback = await fetchApp("/api/auth/telegram/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, nonceToken: start.nonceToken }),
  });
  const cookie = cookiePair(callback, SESSION_COOKIE);

  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.telegramId, profile.id))
    .limit(1);

  return { steps: [start.nonceResponse, callback], cookie, user: user ?? null };
}
