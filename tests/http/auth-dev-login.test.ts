/** Локальный вход без Telegram: включённый и выключенный флаг. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";

import { authSessions, users } from "../../lib/db/schema";
import { fetchApp, startApp, type AppHandle } from "./support/app";
import { loginAs } from "./support/auth";
import { cookiePair } from "./support/cookies";
import { createUser, db, resetDatabase } from "./support/db";
import { telegramStub } from "./support/telegram";

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

describe("DEV_LOGIN_ENABLED=1", () => {
  test("входит и ставит рабочую cookie", async () => {
    const response = await fetchApp("/api/auth/dev-login?telegramId=777&name=Dev");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${inject("appUrl")}/s`);

    const cookie = cookiePair(response, "studio_session");
    expect(cookie).not.toBeNull();

    const me = await fetchApp("/api/auth/me", { headers: { cookie: cookie! } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ name: "Dev", isOperator: false });
  });

  test("operator=1 выставляет оператора", async () => {
    const response = await fetchApp("/api/auth/dev-login?telegramId=778&operator=1");
    const cookie = cookiePair(response, "studio_session");

    const me = await fetchApp("/api/auth/me", { headers: { cookie: cookie! } });
    expect(await me.json()).toMatchObject({ name: "Пользователь 778", isOperator: true });
  });

  test("имя по умолчанию — «Пользователь <id>»", async () => {
    const response = await fetchApp("/api/auth/dev-login?telegramId=779");
    const cookie = cookiePair(response, "studio_session");

    const me = await fetchApp("/api/auth/me", { headers: { cookie: cookie! } });
    expect(await me.json()).toMatchObject({ name: "Пользователь 779" });
  });

  test("при создании сессии удаляет просроченные строки пользователя", async () => {
    const user = await createUser({ telegramId: 782 });
    await loginAs(user, { expired: true });

    const response = await fetchApp("/api/auth/dev-login?telegramId=782");
    expect(cookiePair(response, "studio_session")).not.toBeNull();

    const sessions = await db().select().from(authSessions);
    expect(sessions.filter((row) => row.userId === user.id)).toHaveLength(1);
  });

  test("не стирает username и фото существующего пользователя", async () => {    await createUser({
      telegramId: 781,
      name: "Старое имя",
      username: "real_user",
      photoUrl: "https://example.com/avatar.png",
    });

    const response = await fetchApp("/api/auth/dev-login?telegramId=781&name=Новое имя");
    const cookie = cookiePair(response, "studio_session");

    const me = await fetchApp("/api/auth/me", { headers: { cookie: cookie! } });
    expect(await me.json()).toMatchObject({
      name: "Новое имя",
      username: "real_user",
      photoUrl: "https://example.com/avatar.png",
    });
  });

  test("заблокированного отправляет на error=blocked", async () => {
    const user = await createUser({ telegramId: 780 });
    await db().update(users).set({ isBlocked: true }).where(eq(users.id, user.id));

    const response = await fetchApp("/api/auth/dev-login?telegramId=780");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${inject("appUrl")}/login?error=blocked`);
    expect(cookiePair(response, "studio_session")).toBeNull();
  });

  test("нечисловой telegramId — 400", async () => {
    for (const value of ["abc", "0", "-5", "1.5"]) {
      const response = await fetchApp(`/api/auth/dev-login?telegramId=${value}`);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "bad_request", message: expect.any(String) },
      });
    }
  });
});

describe("DEV_LOGIN_ENABLED=0", () => {
  let second: AppHandle;

  beforeAll(async () => {
    second = await startApp({ env: { DEV_LOGIN_ENABLED: "0" } });
  });

  afterAll(async () => {
    await second.stop();
  });

  test("маршрут отвечает 404 not_found", async () => {
    const response = await fetch(`${second.url}/api/auth/dev-login?telegramId=777`, {
      redirect: "manual",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Страница не найдена" },
    });
  });
});
