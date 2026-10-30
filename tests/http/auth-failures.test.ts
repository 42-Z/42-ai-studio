/**
 * Все подделки и сбои входа: 302 на `/login?error=failed`, без cookie сессии
 * и без новой строки `users`.
 */
import { SignJWT } from "jose";
import { beforeEach, describe, expect, inject, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { authSessions, users } from "../../lib/db/schema";
import { beginTelegramLogin, loginViaTelegram } from "./support/auth";
import { db, resetDatabase, userCount } from "./support/db";
import type { TamperKind } from "./support/oidc-issuer";
import { telegramStub } from "./support/telegram";

function expectFailed(response: Response): void {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${inject("appUrl")}/login?error=failed`);
  const session = response.headers
    .getSetCookie()
    .find((header) => header.startsWith("studio_session="));
  expect(session).toBeUndefined();
}

async function callbackUrlFromIssuer(): Promise<{
  callbackUrl: URL;
  oidcCookie: string | null;
}> {
  const start = await beginTelegramLogin("/s");
  const authorize = await fetch(start.authorizeUrl, { redirect: "manual" });
  const location = authorize.headers.get("location");
  if (location === null) throw new Error("издатель не вернул Location");
  return { callbackUrl: new URL(location), oidcCookie: start.oidcCookie };
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

    expectFailed(result.steps[2]);
    expect(result.cookie).toBeNull();
    expect(await userCount()).toBe(0);
    expect(await db().select().from(authSessions)).toHaveLength(0);
  });
});

describe("сбои контейнера и кода", () => {
  test("чужой state отвергается", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    callbackUrl.searchParams.set("state", "подменённый");

    const response = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: oidcCookie! },
    });

    expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("без cookie studio_oidc вход не удаётся", async () => {
    const { callbackUrl } = await callbackUrlFromIssuer();

    const response = await fetch(callbackUrl, { redirect: "manual" });

    expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("подделанная cookie studio_oidc отвергается", async () => {
    const { callbackUrl } = await callbackUrlFromIssuer();

    const response = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: "studio_oidc=not-a-jwt" },
    });

    expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("просроченная cookie studio_oidc отвергается", async () => {
    const { callbackUrl } = await callbackUrlFromIssuer();
    const secret = new TextEncoder().encode(loadConfig().sessionSecret);
    const expired = await new SignJWT({
      state: "x",
      nonce: "y",
      verifier: "z",
      next: "/s",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);

    const response = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: `studio_oidc=${expired}` },
    });

    expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("повторное использование code отвергается", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();

    const first = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: oidcCookie! },
    });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`${inject("appUrl")}/s`);

    const second = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: oidcCookie! },
    });

    expectFailed(second);
    expect(await userCount()).toBe(1);
    expect(await db().select().from(users)).toHaveLength(1);
    expect(await db().select().from(authSessions)).toHaveLength(1);
  });

  test("отказ пользователя у издателя даёт error=failed", async () => {
    await telegramStub.authorize("deny");

    const result = await loginViaTelegram();

    expectFailed(result.steps[2]);
    expect(await userCount()).toBe(0);
  });

  test("callback без code даёт error=failed", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    callbackUrl.searchParams.delete("code");

    const response = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: oidcCookie! },
    });

    expectFailed(response);
    expect(await userCount()).toBe(0);
  });

  test("пустой параметр error считается отказом", async () => {
    const { callbackUrl, oidcCookie } = await callbackUrlFromIssuer();
    callbackUrl.searchParams.set("error", "");

    const response = await fetch(callbackUrl, {
      redirect: "manual",
      headers: { cookie: oidcCookie! },
    });

    expectFailed(response);
    expect(await userCount()).toBe(0);
  });
});
