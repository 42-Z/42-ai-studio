/**
 * Отказы OIDC-входа: редирект с ошибкой и очистка временной cookie.
 * Код и nonce одноразовые, в том числе при одновременных callback.
 */
import { eq } from "drizzle-orm";
import { SignJWT, decodeJwt, type JWTPayload } from "jose";
import { beforeEach, describe, expect, inject, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { authSessions, users } from "../../lib/db/schema";
import { fetchApp } from "./support/app";
import {
  beginTelegramLogin,
  loginViaTelegram,
  type StartedTelegramLogin,
} from "./support/auth";
import {
  cookieAttribute,
  cookiePair,
  hasCookieAttribute,
  requireSetCookie,
  setCookieHeader,
} from "./support/cookies";
import { createUser, db, resetDatabase, userCount } from "./support/db";
import { DEFAULT_PROFILE, type TamperKind } from "./support/oidc-issuer";
import { telegramStub } from "./support/telegram";

function expectOidcCleared(response: Response): void {
  const cleared = requireSetCookie(response, "studio_oidc");
  expect(cleared.startsWith("studio_oidc=;")).toBe(true);
  expect(cookieAttribute(cleared, "Max-Age")).toBe("0");
  expect(cookieAttribute(cleared, "Path")).toBe("/api/auth/telegram");
  expect(hasCookieAttribute(cleared, "HttpOnly")).toBe(true);
  expect(cookieAttribute(cleared, "SameSite")?.toLowerCase()).toBe("lax");
}

function expectRejected(response: Response, error: "failed" | "blocked" = "failed"): void {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${inject("appUrl")}/login?error=${error}`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(setCookieHeader(response, "studio_session")).toBeNull();
  expectOidcCleared(response);
}

function expectSuccessful(response: Response): void {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${inject("appUrl")}/s`);
  expect(cookiePair(response, "studio_session")).not.toBeNull();
  expectOidcCleared(response);
}

function getCallback(url: URL, cookie?: string): Promise<Response> {
  return fetch(url, {
    redirect: "manual",
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function callbackUrlFromIssuer(
  start?: StartedTelegramLogin,
): Promise<{ callbackUrl: URL; oidcCookie: string }> {
  const login = start ?? (await beginTelegramLogin());
  expect(login.login.status).toBe(302);
  if (login.oidcCookie === null) throw new Error("начало входа не выдало studio_oidc");
  const authorize = await fetch(login.authorizeUrl, { redirect: "manual" });
  expect(authorize.status).toBe(302);
  const location = authorize.headers.get("location");
  if (location === null) throw new Error("издатель не вернул Location");
  const callbackUrl = new URL(location);
  if (!callbackUrl.searchParams.get("code")) throw new Error("издатель не выдал код");
  return { callbackUrl, oidcCookie: login.oidcCookie };
}

/** Меняет только нужный claim настоящей cookie, сохраняя state, nonce и PKCE. */
async function changeContainer(
  cookie: string,
  change: (payload: JWTPayload) => void,
  foreignKey = false,
): Promise<string> {
  const payload = decodeJwt(cookie.slice("studio_oidc=".length));
  change(payload);
  const secret = foreignKey ? "foreign-test-session-secret-0123456789" : loadConfig().sessionSecret;
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(secret));
  return `studio_oidc=${token}`;
}

async function expectNoLoginData(): Promise<void> {
  expect(await userCount()).toBe(0);
  expect(await db().select().from(authSessions)).toHaveLength(0);
}

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

const TAMPERS: TamperKind[] = [
  "bad_signature",
  "bad_aud",
  "bad_iss",
  "expired",
  "bad_nonce",
  "no_nonce",
  "no_id",
  "alg_none",
  "alg_hs256",
  "unknown_kid",
];

describe("порча id_token", () => {
  test.each(TAMPERS)("«%s» не пускает пользователя", async (kind) => {
    await telegramStub.tamper(kind);

    const result = await loginViaTelegram();

    expectRejected(result.steps[2]);
    expect(result.cookie).toBeNull();
    await expectNoLoginData();
  });
});

describe("cookie studio_oidc и state", () => {
  test("чужой state отвергается", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    callbackUrl.searchParams.set("state", "подменённый-state");

    const response = await getCallback(callbackUrl, oidcCookie);

    expectRejected(response);
    await expectNoLoginData();
  });

  test("без cookie studio_oidc вход не удаётся", async () => {
    const { callbackUrl } = await callbackUrlFromIssuer();

    const response = await getCallback(callbackUrl);

    expectRejected(response);
    await expectNoLoginData();
  });

  test("повреждённая cookie studio_oidc отвергается", async () => {
    const { callbackUrl } = await callbackUrlFromIssuer();

    const response = await getCallback(callbackUrl, "studio_oidc=not-a-jwt");

    expectRejected(response);
    await expectNoLoginData();
  });

  test("cookie с чужой подписью отвергается", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    const forged = await changeContainer(oidcCookie, () => {}, true);

    const response = await getCallback(callbackUrl, forged);

    expectRejected(response);
    await expectNoLoginData();
  });

  test("просроченная cookie studio_oidc отвергается", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    const expired = await changeContainer(oidcCookie, (payload) => {
      const now = Math.floor(Date.now() / 1000);
      payload.iat = now - 120;
      payload.exp = now - 60;
    });

    const response = await getCallback(callbackUrl, expired);

    expectRejected(response);
    await expectNoLoginData();
  });

  test.each(["exp", "iat"] as const)("cookie без %s отвергается", async (claim) => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    const incomplete = await changeContainer(oidcCookie, (payload) => {
      delete payload[claim];
    });

    const response = await getCallback(callbackUrl, incomplete);

    expectRejected(response);
    await expectNoLoginData();
  });
});

describe("отказ издателя и параметры callback", () => {
  test("чужой Origin не создаёт сессию и очищает временную cookie", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    const response = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: oidcCookie, origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expectOidcCleared(response);
    expect(setCookieHeader(response, "studio_session")).toBeNull();
    await expectNoLoginData();
  });

  test("отказ пользователя у издателя даёт error=failed", async () => {
    await telegramStub.authorize("deny");

    const result = await loginViaTelegram();

    expectRejected(result.steps[2]);
    await expectNoLoginData();
  });

  test.each(["code", "state"])("без параметра %s вход не удаётся", async (parameter) => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    callbackUrl.searchParams.delete(parameter);

    const response = await getCallback(callbackUrl, oidcCookie);

    expectRejected(response);
    await expectNoLoginData();
  });

  test("пустой параметр error тоже считается отказом", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    callbackUrl.searchParams.set("error", "");

    const response = await getCallback(callbackUrl, oidcCookie);

    expectRejected(response);
    await expectNoLoginData();
  });
});

describe("одноразовые code и nonce", () => {
  test("повторное использование code не создаёт вторую сессию", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();

    const first = await getCallback(callbackUrl, oidcCookie);
    expectSuccessful(first);

    const second = await getCallback(callbackUrl, oidcCookie);

    expectRejected(second);
    expect(await userCount()).toBe(1);
    expect(await db().select().from(authSessions)).toHaveLength(1);
  });

  test("новый code с уже погашенным nonce не создаёт вторую сессию", async () => {
    const start = await beginTelegramLogin();
    const first = await callbackUrlFromIssuer(start);
    const second = await callbackUrlFromIssuer(start);
    expect(first.callbackUrl.searchParams.get("code") === second.callbackUrl.searchParams.get("code"))
      .toBe(false);

    expectSuccessful(await getCallback(first.callbackUrl, first.oidcCookie));
    expectRejected(await getCallback(second.callbackUrl, second.oidcCookie));

    expect(await userCount()).toBe(1);
    expect(await db().select().from(authSessions)).toHaveLength(1);
  });

  test.each(["одним code", "разными code"])(
    "из двух одновременных callback с %s и одним nonce проходит только один",
    async (mode) => {
      const start = await beginTelegramLogin();
      const first = await callbackUrlFromIssuer(start);
      const second = mode === "одним code" ? first : await callbackUrlFromIssuer(start);
      if (mode === "разными code") {
        expect(first.callbackUrl.searchParams.get("code") === second.callbackUrl.searchParams.get("code"))
          .toBe(false);
      }

      const responses = await Promise.all([
        getCallback(first.callbackUrl, first.oidcCookie),
        getCallback(second.callbackUrl, second.oidcCookie),
      ]);

      expect(responses.map((response) => response.headers.get("location")).sort()).toEqual([
        `${inject("appUrl")}/login?error=failed`,
        `${inject("appUrl")}/s`,
      ]);
      for (const response of responses) {
        if (response.headers.get("location") === `${inject("appUrl")}/s`) {
          expectSuccessful(response);
        } else {
          expectRejected(response);
        }
      }
      expect(await userCount()).toBe(1);
      expect(await db().select().from(authSessions)).toHaveLength(1);
    },
  );
});

describe("заблокированный пользователь", () => {
  test("callback ведёт на error=blocked без сессии и изменения профиля", async () => {
    const user = await createUser({
      telegramId: DEFAULT_PROFILE.id,
      name: "Сохранённое имя",
      username: "stored_user",
      photoUrl: "https://example.com/stored-avatar.png",
      isBlocked: true,
      lastLoginAt: new Date("2026-01-01T00:00:00Z"),
    });

    const result = await loginViaTelegram();

    expectRejected(result.steps[2], "blocked");
    expect(result.cookie).toBeNull();
    expect(await userCount()).toBe(1);
    expect(await db().select().from(authSessions)).toHaveLength(0);

    const [row] = await db().select().from(users).where(eq(users.id, user.id));
    expect(row).toEqual(user);
  });
});

describe("удалённый popup API", () => {
  test("POST callback больше не принимает вход", async () => {
    const response = await fetchApp("/api/auth/telegram/callback", { method: "POST" });

    expect(response.status).toBe(405);
    expect(setCookieHeader(response, "studio_session")).toBeNull();
    await expectNoLoginData();
  });

  test("POST nonce больше не существует", async () => {
    const response = await fetchApp("/api/auth/telegram/nonce", { method: "POST" });

    expect(response.status).toBe(404);
    expect(setCookieHeader(response, "studio_session")).toBeNull();
    await expectNoLoginData();
  });
});
