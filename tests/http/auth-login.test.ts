/**
 * Начало popup-входа, полный проход через тестовый издатель и повторный вход.
 * Приложение уже запущено глобальной подготовкой.
 */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { sessionCookieAttributes } from "../../lib/auth/cookies";
import { authSessions, users } from "../../lib/db/schema";
import { fetchApp } from "./support/app";
import { loginAs, loginViaTelegram } from "./support/auth";
import {
  cookieAttribute,
  hasCookieAttribute,
  requireSetCookie,
  setCookieHeader,
} from "./support/cookies";
import { db, resetDatabase } from "./support/db";
import { DEFAULT_PROFILE } from "./support/oidc-issuer";
import { telegramStub } from "./support/telegram";

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

describe("POST /api/auth/telegram/nonce", () => {
  test("выдаёт nonce и подписанный токен", async () => {
    const response = await fetchApp("/api/auth/telegram/nonce", { method: "POST" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { nonce: string; token: string };
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.token.split(".")).toHaveLength(3);
    expect(setCookieHeader(response, "studio_session")).toBeNull();
  });

  test("чужой Origin отвергается", async () => {
    const response = await fetchApp("/api/auth/telegram/nonce", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Доступ закрыт" },
    });
  });
});

describe("полный вход через тестовый издатель", () => {
  test("создаёт пользователя и сессию, ставит cookie", async () => {
    const result = await loginViaTelegram();

    const callback = result.steps[1];
    expect(callback.status).toBe(200);
    expect(await callback.json()).toEqual({ ok: true });

    const session = requireSetCookie(callback, "studio_session");
    expect(hasCookieAttribute(session, "HttpOnly")).toBe(true);
    expect(cookieAttribute(session, "SameSite")?.toLowerCase()).toBe("lax");
    expect(hasCookieAttribute(session, "Secure")).toBe(false);
    expect(Number(cookieAttribute(session, "Max-Age"))).toBe(30 * 24 * 60 * 60);

    expect(result.cookie).not.toBeNull();
    expect(result.user).not.toBeNull();
    expect(result.user!.telegramId).toBe(DEFAULT_PROFILE.id);
    expect(result.user!.name).toBe(DEFAULT_PROFILE.name);
    expect(result.user!.username).toBe(DEFAULT_PROFILE.preferred_username);
    expect(result.user!.photoUrl).toBe(DEFAULT_PROFILE.picture);

    const sessions = await db().select().from(authSessions);
    const userSessions = sessions.filter((row) => row.userId === result.user!.id);
    expect(userSessions).toHaveLength(1);
    const token = result.cookie!.split("=")[1];
    expect(userSessions[0].tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(userSessions[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(userSessions[0].tokenHash).not.toBe(token);

    const me = await fetchApp("/api/auth/me", { headers: { cookie: result.cookie! } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      id: result.user!.id,
      name: DEFAULT_PROFILE.name,
      username: DEFAULT_PROFILE.preferred_username,
      photoUrl: DEFAULT_PROFILE.picture,
      isOperator: false,
    });
  });

  test("повторный вход обновляет пользователя и создаёт новую сессию", async () => {
    const first = await loginViaTelegram();

    const second = await loginViaTelegram({ ...DEFAULT_PROFILE, name: "Новое Имя" });

    const rows = await db().select().from(users);
    expect(rows.filter((row) => row.telegramId === 4242)).toHaveLength(1);
    expect(second.user!.id).toBe(first.user!.id);
    expect(second.user!.name).toBe("Новое Имя");
    expect(second.user!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(
      first.user!.lastLoginAt!.getTime(),
    );

    const sessions = await db().select().from(authSessions);
    const userSessions = sessions.filter((row) => row.userId === first.user!.id);
    expect(userSessions).toHaveLength(2);
  });

  test("другой Telegram ID создаёт второго пользователя", async () => {
    const first = await loginViaTelegram();
    const second = await loginViaTelegram({ ...DEFAULT_PROFILE, id: 5151, name: "Другой" });

    expect(second.user).not.toBeNull();
    expect(second.user!.id).not.toBe(first.user!.id);

    const rows = await db().select().from(users);
    expect(rows.filter((row) => row.telegramId === 4242)).toHaveLength(1);
    expect(rows.filter((row) => row.telegramId === 5151)).toHaveLength(1);
  });
});

describe("атрибуты cookie", () => {
  test("Secure только для https-адреса", () => {
    expect(sessionCookieAttributes("https://studio.example.com", 30).secure).toBe(true);
    expect(sessionCookieAttributes("http://localhost:3100", 30).secure).toBe(false);
  });
});

describe("страница входа", () => {
  test("содержит COOP-заголовок и обе настроенные кнопки", async () => {
    const response = await fetchApp("/login");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(body).toContain("Вход");
    expect(body).toContain("Войти через Telegram");
    expect(body).toContain("Войти как разработчик");
    expect(setCookieHeader(response, "studio_session")).toBeNull();
  });

  test("вошедшего перенаправляет на next", async () => {
    const result = await loginViaTelegram();
    const cookie = await loginAs(result.user!);

    const response = await fetchApp("/login?next=%2Fs%2Fsession-1", { headers: { cookie } });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/s/session-1");
  });

  test("заблокированному показывает сообщение, не перенаправляя", async () => {
    const result = await loginViaTelegram();
    await db().update(users).set({ isBlocked: true }).where(eq(users.id, result.user!.id));
    const cookie = await loginAs(result.user!);

    const response = await fetchApp("/login", { headers: { cookie } });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      "Доступ к сервису закрыт для этого аккаунта. Если это ошибка, напишите владельцу сервиса.",
    );
  });
});
