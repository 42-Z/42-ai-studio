/**
 * Подделки и сбои popup-входа: 401 `failed`, без cookie сессии и без строки
 * `users`. Nonce одноразовый: повторная пара «nonce + id_token» не проходит.
 */
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { authSessions, users } from "../../lib/db/schema";
import { fetchApp } from "./support/app";
import { beginTelegramLogin, loginViaTelegram } from "./support/auth";
import { setCookieHeader } from "./support/cookies";
import { createUser, db, resetDatabase, userCount } from "./support/db";
import type { TamperKind } from "./support/oidc-issuer";
import { telegramStub } from "./support/telegram";

async function expectFailed(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: "failed", message: "Не удалось войти" },
  });
  expect(setCookieHeader(response, "studio_session")).toBeNull();
}

function postCallback(body: Record<string, unknown>): Promise<Response> {
  return fetchApp("/api/auth/telegram/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

    await expectFailed(result.steps[1]);
    expect(result.cookie).toBeNull();
    expect(await userCount()).toBe(0);
    expect(await db().select().from(authSessions)).toHaveLength(0);
  });
});

describe("токен nonce", () => {
  test("без nonce-токена вход не удаётся", async () => {
    const start = await beginTelegramLogin();
    const idToken = await telegramStub.idTokenFor(start.nonce);

    const response = await postCallback({ idToken });

    await expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("подделанный nonce-токен отвергается", async () => {
    const start = await beginTelegramLogin();
    const idToken = await telegramStub.idTokenFor(start.nonce);

    const response = await postCallback({ idToken, nonceToken: "not-a-jwt" });

    await expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("просроченный nonce-токен отвергается", async () => {
    const start = await beginTelegramLogin();
    const idToken = await telegramStub.idTokenFor(start.nonce);
    const secret = new TextEncoder().encode(loadConfig().sessionSecret);
    const expired = await new SignJWT({ nonce: start.nonce })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);

    const response = await postCallback({ idToken, nonceToken: expired });

    await expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("чужой nonce отвергается", async () => {
    const start = await beginTelegramLogin();
    const idToken = await telegramStub.idTokenFor("другой-nonce");

    const response = await postCallback({
      idToken,
      nonceToken: start.nonceToken,
    });

    await expectFailed(response);
    expect(await userCount()).toBe(0);
  });
});

describe("тело запроса", () => {
  test("без id_token вход не удаётся", async () => {
    const start = await beginTelegramLogin();

    const response = await postCallback({ nonceToken: start.nonceToken });

    await expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("id_token не строка — вход не удаётся", async () => {
    const start = await beginTelegramLogin();

    const response = await postCallback({ idToken: 123, nonceToken: start.nonceToken });

    await expectFailed(response);
    expect(await userCount()).toBe(0);
  });
});

describe("одноразовый nonce", () => {
  test("повторная пара nonce и id_token не создаёт вторую сессию", async () => {
    const start = await beginTelegramLogin();
    const idToken = await telegramStub.idTokenFor(start.nonce);
    const body = { idToken, nonceToken: start.nonceToken };

    const first = await postCallback(body);
    expect(first.status).toBe(200);

    const second = await postCallback(body);

    await expectFailed(second);
    expect(await userCount()).toBe(1);
    expect(await db().select().from(authSessions)).toHaveLength(1);
  });

  test("из двух одновременных callback проходит только один", async () => {
    const start = await beginTelegramLogin();
    const idToken = await telegramStub.idTokenFor(start.nonce);
    const body = { idToken, nonceToken: start.nonceToken };

    const responses = await Promise.all([postCallback(body), postCallback(body)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await db().select().from(authSessions)).toHaveLength(1);
  });
});

describe("заблокированный пользователь", () => {
  test("callback отвечает 403 user_blocked и не создаёт сессию", async () => {
    const user = await createUser({ telegramId: 4242, name: "Заблокированный" });
    await db().update(users).set({ isBlocked: true }).where(eq(users.id, user.id));

    const result = await loginViaTelegram();

    expect(result.steps[1].status).toBe(403);
    expect(await result.steps[1].json()).toEqual({
      error: { code: "user_blocked", message: "Доступ закрыт" },
    });
    expect(result.cookie).toBeNull();
    expect(await db().select().from(authSessions)).toHaveLength(0);

    const [row] = await db().select().from(users).where(eq(users.id, user.id));
    expect(row.lastLoginAt).toBeNull();
  });
});
