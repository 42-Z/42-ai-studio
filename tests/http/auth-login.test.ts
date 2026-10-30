/**
 * Начало входа, полный проход через тестовый издатель и повторный вход.
 * Приложение уже запущено глобальной подготовкой.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, inject, test } from "vitest";

import { sessionCookieAttributes } from "../../lib/auth/cookies";
import { loadConfig } from "../../lib/config";
import { authSessions, users } from "../../lib/db/schema";
import { fetchApp } from "./support/app";
import { loginViaTelegram } from "./support/auth";
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

describe("GET /api/auth/telegram/login", () => {
  test("отдаёт 302 с параметрами OIDC и cookie studio_oidc", async () => {
    const response = await fetchApp("/api/auth/telegram/login?next=%2Fs");

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const location = response.headers.get("location");
    expect(location).not.toBeNull();
    const config = loadConfig();
    const authorization = new URL(location!);
    expect(authorization.origin).toBe(config.telegramOidcIssuer);
    expect(authorization.pathname).toBe("/auth");

    const query = authorization.searchParams;
    expect(query.get("client_id")).toBe(config.telegramClientId);
    expect(query.get("redirect_uri")).toBe(`${config.appUrl}/api/auth/telegram/callback`);
    expect(query.get("response_type")).toBe("code");
    expect(query.get("scope")).toBe("openid profile");
    expect(query.get("state")?.length).toBeGreaterThan(0);
    expect(query.get("nonce")?.length).toBeGreaterThan(0);
    expect(query.get("code_challenge")?.length).toBe(43);
    expect(query.get("code_challenge_method")).toBe("S256");

    const cookie = requireSetCookie(response, "studio_oidc");
    expect(cookieAttribute(cookie, "Path")).toBe("/api/auth/telegram");
    expect(hasCookieAttribute(cookie, "HttpOnly")).toBe(true);
    expect(cookieAttribute(cookie, "SameSite")?.toLowerCase()).toBe("lax");
    expect(Number(cookieAttribute(cookie, "Max-Age"))).toBeLessThanOrEqual(600);
    expect(hasCookieAttribute(cookie, "Secure")).toBe(false);
  });
});

describe("полный вход через тестовый издатель", () => {
  test("создаёт пользователя и сессию, ставит cookie", async () => {
    const result = await loginViaTelegram();

    const callback = result.steps[2];
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${inject("appUrl")}/s`);

    const session = requireSetCookie(callback, "studio_session");
    expect(hasCookieAttribute(session, "HttpOnly")).toBe(true);
    expect(cookieAttribute(session, "SameSite")?.toLowerCase()).toBe("lax");
    expect(hasCookieAttribute(session, "Secure")).toBe(false);
    expect(Number(cookieAttribute(session, "Max-Age"))).toBe(30 * 24 * 60 * 60);

    const cleared = requireSetCookie(callback, "studio_oidc");
    expect(Number(cookieAttribute(cleared, "Max-Age"))).toBe(0);
    expect(cookieAttribute(cleared, "Path")).toBe("/api/auth/telegram");

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

  test("небезопасный next после входа ведёт на /s", async () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil"]) {
      await telegramStub.reset();
      const result = await loginViaTelegram(DEFAULT_PROFILE, { next });
      expect(result.steps[0].status).toBe(302);
      expect(result.steps[2].headers.get("location")).toBe(`${inject("appUrl")}/s`);
    }
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
    expect(body).toContain("/api/auth/telegram/login?next=%2Fs");
    expect(body).toContain("Войти через Telegram");
    expect(body).toContain("Войти как разработчик");
    expect(setCookieHeader(response, "studio_session")).toBeNull();
  });
});
