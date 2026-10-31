/**
 * Начало входа, полный проход через тестовый издатель и повторный вход.
 * Приложение уже запущено глобальной подготовкой.
 */
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, inject, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { oidcCookieAttributes, sessionCookieAttributes } from "../../lib/auth/cookies";
import { authSessions, users } from "../../lib/db/schema";
import { fetchApp } from "./support/app";
import { beginTelegramLogin, loginAs, loginViaTelegram } from "./support/auth";
import {
  cookieAttribute,
  hasCookieAttribute,
  requireSetCookie,
  setCookieHeader,
} from "./support/cookies";
import { db, resetDatabase, userCount } from "./support/db";
import { DEFAULT_PROFILE } from "./support/oidc-issuer";
import { telegramStub } from "./support/telegram";

interface CurrentUser {
  id: string;
  name: string;
  username: string | null;
  photoUrl: string | null;
  isOperator: boolean;
}

async function readProfile(cookie: string | null): Promise<CurrentUser> {
  if (cookie === null) throw new Error("вход не выдал cookie сессии");
  const response = await fetchApp("/api/auth/me", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as CurrentUser;
}

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

describe("GET /api/auth/telegram/login", () => {
  test("чужой Origin не начинает вход", async () => {
    const response = await fetchApp("/api/auth/telegram/login", {
      headers: { origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(setCookieHeader(response, "studio_oidc")).toBeNull();
  });

  test("отдаёт 302 с параметрами OIDC и временной HttpOnly cookie", async () => {
    const response = await fetchApp("/api/auth/telegram/login?next=%2Fs");

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const location = response.headers.get("location");
    if (location === null) throw new Error("начало входа не вернуло Location");
    const config = loadConfig();
    const authorization = new URL(location);
    expect(authorization.origin).toBe(new URL(config.telegramOidcIssuer).origin);
    expect(authorization.pathname).toBe("/auth");

    const query = authorization.searchParams;
    expect(query.get("client_id")).toBe(config.telegramClientId);
    expect(query.get("redirect_uri")).toBe(`${config.appUrl}/api/auth/telegram/callback`);
    expect(query.get("response_type")).toBe("code");
    expect(query.get("scope")).toBe("openid profile");
    expect(query.get("state")?.length).toBeGreaterThan(0);
    expect(query.get("nonce")?.length).toBeGreaterThan(0);
    expect(query.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.has("code_verifier")).toBe(false);
    expect(query.has("client_secret")).toBe(false);

    const cookie = requireSetCookie(response, "studio_oidc");
    expect(cookieAttribute(cookie, "Path")).toBe("/api/auth/telegram");
    expect(hasCookieAttribute(cookie, "HttpOnly")).toBe(true);
    expect(cookieAttribute(cookie, "SameSite")?.toLowerCase()).toBe("lax");
    expect(Number(cookieAttribute(cookie, "Max-Age"))).toBeGreaterThan(0);
    expect(Number(cookieAttribute(cookie, "Max-Age"))).toBeLessThanOrEqual(600);
    expect(hasCookieAttribute(cookie, "Secure")).toBe(false);
    expect(setCookieHeader(response, "studio_session")).toBeNull();
  });

  test("каждое начало входа получает новые state, nonce и PKCE challenge", async () => {
    const first = await beginTelegramLogin();
    const second = await beginTelegramLogin();

    expect(first.login.status).toBe(302);
    expect(second.login.status).toBe(302);
    const firstQuery = new URL(first.authorizeUrl).searchParams;
    const secondQuery = new URL(second.authorizeUrl).searchParams;
    for (const name of ["state", "nonce", "code_challenge"]) {
      expect(firstQuery.get(name) === secondQuery.get(name)).toBe(false);
    }
  });
});

describe("полный вход через тестовый издатель", () => {
  test("возвращает на /s с рабочей сессией и профилем Telegram", async () => {
    const result = await loginViaTelegram();

    expect(result.steps.map((step) => step.status)).toEqual([302, 302, 302]);
    const callback = result.steps[2];
    expect(callback.headers.get("location")).toBe(`${inject("appUrl")}/s`);
    expect(callback.headers.get("cache-control")).toBe("no-store");

    const session = requireSetCookie(callback, "studio_session");
    expect(cookieAttribute(session, "Path")).toBe("/");
    expect(hasCookieAttribute(session, "HttpOnly")).toBe(true);
    expect(cookieAttribute(session, "SameSite")?.toLowerCase()).toBe("lax");
    expect(hasCookieAttribute(session, "Secure")).toBe(false);
    expect(Number(cookieAttribute(session, "Max-Age"))).toBe(30 * 24 * 60 * 60);

    const cleared = requireSetCookie(callback, "studio_oidc");
    expect(Number(cookieAttribute(cleared, "Max-Age"))).toBe(0);
    expect(cookieAttribute(cleared, "Path")).toBe("/api/auth/telegram");

    expect(await readProfile(result.cookie)).toEqual({
      id: expect.any(String),
      name: DEFAULT_PROFILE.name,
      username: DEFAULT_PROFILE.preferred_username,
      photoUrl: DEFAULT_PROFILE.picture,
      isOperator: false,
    });

    if (result.cookie === null) throw new Error("не выдана cookie сессии");
    const token = result.cookie.slice("studio_session=".length);
    const sessions = await db().select().from(authSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(sessions[0].tokenHash === token).toBe(false);
  });

  test("повторный вход обновляет профиль и сохраняет прежнюю сессию", async () => {
    const first = await loginViaTelegram();
    const firstProfile = await readProfile(first.cookie);
    const previousLogin = new Date("2020-01-01T00:00:00Z");
    await db().update(users).set({ lastLoginAt: previousLogin }).where(eq(users.id, firstProfile.id));

    const second = await loginViaTelegram({ ...DEFAULT_PROFILE, name: "Новое Имя" });
    const secondProfile = await readProfile(second.cookie);

    expect(secondProfile).toEqual({ ...firstProfile, name: "Новое Имя" });
    expect(second.cookie === first.cookie).toBe(false);
    expect(await readProfile(first.cookie)).toEqual(secondProfile);
    expect(await userCount()).toBe(1);
    expect(await db().select().from(authSessions)).toHaveLength(2);
    const [updated] = await db().select().from(users).where(eq(users.id, firstProfile.id));
    expect(updated.lastLoginAt!.getTime()).toBeGreaterThan(previousLogin.getTime());
  });

  test("другой Telegram ID создаёт второго пользователя", async () => {
    const first = await loginViaTelegram();
    const second = await loginViaTelegram({ ...DEFAULT_PROFILE, id: 5151, name: "Другой" });

    const firstProfile = await readProfile(first.cookie);
    const secondProfile = await readProfile(second.cookie);
    expect(secondProfile.id).not.toBe(firstProfile.id);
    expect(firstProfile.name).toBe(DEFAULT_PROFILE.name);
    expect(secondProfile.name).toBe("Другой");
  });

  test("строковый Telegram ID входит в тот же аккаунт, что и числовой", async () => {
    const first = await loginViaTelegram({ ...DEFAULT_PROFILE, id: 4294967297 });
    const firstProfile = await readProfile(first.cookie);

    const second = await loginViaTelegram({ ...DEFAULT_PROFILE, id: "4294967297" });

    expect(second.steps[2].headers.get("location")).toBe(`${inject("appUrl")}/s`);
    expect(await readProfile(second.cookie)).toEqual(firstProfile);
    expect(await userCount()).toBe(1);
  });

  test("после входа сохраняет безопасный next", async () => {
    const result = await loginViaTelegram(DEFAULT_PROFILE, { next: "/s/session-1" });

    expect(result.steps[2].status).toBe(302);
    expect(result.steps[2].headers.get("location")).toBe(`${inject("appUrl")}/s/session-1`);
    await readProfile(result.cookie);
  });

  test.each(["//evil.example", "https://evil.example", "/\\evil"])(
    "небезопасный next «%s» после входа ведёт на /s",
    async (next) => {
      const result = await loginViaTelegram(DEFAULT_PROFILE, { next });

      expect(result.steps[2].status).toBe(302);
      expect(result.steps[2].headers.get("location")).toBe(`${inject("appUrl")}/s`);
      await readProfile(result.cookie);
    },
  );

  test("отсутствующие необязательные поля профиля возвращает как null", async () => {
    const result = await loginViaTelegram({ id: 5151, name: "Без фото" });

    expect(await readProfile(result.cookie)).toEqual({
      id: expect.any(String),
      name: "Без фото",
      username: null,
      photoUrl: null,
      isOperator: false,
    });
  });
});

describe("атрибуты cookie входа", () => {
  test.each([
    ["https://studio.example.com", true],
    ["http://localhost:3000", false],
  ] as const)("Secure для %s равен %s", (appUrl, secure) => {
    expect(sessionCookieAttributes(appUrl, 30).secure).toBe(secure);
    expect(oidcCookieAttributes(appUrl).secure).toBe(secure);
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
