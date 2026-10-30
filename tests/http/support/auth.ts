/**
 * Помощники входа для HTTP-тестов: готовая сессия в базе и полный проход
 * через тестовый издатель OIDC.
 */
import { eq } from "drizzle-orm";

import { SESSION_COOKIE, OIDC_COOKIE } from "../../../lib/auth/cookies";
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
  login: Response;
  oidcCookie: string | null;
  authorizeUrl: string;
}

/** Первый шаг входа: получает адрес издателя и cookie `studio_oidc`. */
export async function beginTelegramLogin(next = "/s"): Promise<StartedTelegramLogin> {
  const login = await fetchApp(`/api/auth/telegram/login?next=${encodeURIComponent(next)}`);
  const authorizeUrl = login.headers.get("location");
  if (authorizeUrl === null) throw new Error("начало входа не вернуло Location");
  return {
    login,
    oidcCookie: cookiePair(login, OIDC_COOKIE),
    authorizeUrl,
  };
}

export interface LoginViaTelegramResult {
  steps: Response[];
  cookie: string | null;
  user: User | null;
}

/**
 * Проходит вход целиком: приложение → тестовый издатель → callback.
 * Профиль задаётся через `telegramStub`; порчу токена тесты выставляют сами.
 */
export async function loginViaTelegram(
  profile: TelegramProfile = DEFAULT_PROFILE,
  options: { next?: string } = {},
): Promise<LoginViaTelegramResult> {
  await telegramStub.setProfile(profile);

  const start = await beginTelegramLogin(options.next ?? "/s");

  const authorize = await fetch(start.authorizeUrl, { redirect: "manual" });
  const callbackLocation = authorize.headers.get("location");
  if (callbackLocation === null) throw new Error("издатель не вернул Location");

  const callback = await fetch(callbackLocation, {
    redirect: "manual",
    headers: start.oidcCookie === null ? {} : { cookie: start.oidcCookie },
  });
  const cookie = cookiePair(callback, SESSION_COOKIE);

  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.telegramId, profile.id))
    .limit(1);

  return { steps: [start.login, authorize, callback], cookie, user: user ?? null };
}
