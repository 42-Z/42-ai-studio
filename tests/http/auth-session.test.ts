/** Страницы и API под защитой сессии, блокировка и выход. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, inject, test } from "vitest";

import { authSessions, users } from "../../lib/db/schema";
import { fetchApp } from "./support/app";
import { loginAs, loginViaTelegram } from "./support/auth";
import { cookieAttribute, requireSetCookie } from "./support/cookies";
import { createUser, db, resetDatabase } from "./support/db";
import { telegramStub } from "./support/telegram";

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

describe("без входа", () => {
  test("страница /s перенаправляет на /login с возвратом", async () => {
    const response = await fetchApp("/s");

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/login?next=%2Fs");
  });

  test("GET /api/auth/me отвечает 401 в формате ошибок", async () => {
    const response = await fetchApp("/api/auth/me");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthenticated", message: "Требуется вход" },
    });
  });
});

describe("сессия входа", () => {
  test("loginAs открывает страницу /s", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await fetchApp("/s", { headers: { cookie } });

    expect(response.status).toBe(200);
  });

  test("просроченная cookie ведёт себя как отсутствующая", async () => {
    const user = await createUser();
    const cookie = await loginAs(user, { expired: true });

    const page = await fetchApp("/s", { headers: { cookie } });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("/login?next=%2Fs");

    const me = await fetchApp("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  test("last_seen_at обновляется не чаще раза в 5 минут", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const [before] = await db().select().from(authSessions);
    await fetchApp("/api/auth/me", { headers: { cookie } });
    const [afterFirst] = await db().select().from(authSessions);
    expect(afterFirst.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());

    await fetchApp("/api/auth/me", { headers: { cookie } });
    const [afterSecond] = await db().select().from(authSessions);
    expect(afterSecond.lastSeenAt.getTime()).toBe(afterFirst.lastSeenAt.getTime());
  });
});

describe("блокировка", () => {
  test("действует со следующего запроса и снимается", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    expect((await fetchApp("/api/auth/me", { headers: { cookie } })).status).toBe(200);

    await db().update(users).set({ isBlocked: true }).where(eq(users.id, user.id));

    const me = await fetchApp("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({
      error: { code: "forbidden", message: "Доступ закрыт" },
    });

    const page = await fetchApp("/s", { headers: { cookie } });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("/login?error=blocked");

    await db().update(users).set({ isBlocked: false }).where(eq(users.id, user.id));

    expect((await fetchApp("/api/auth/me", { headers: { cookie } })).status).toBe(200);
  });

  test("новый вход через Telegram даёт error=blocked и не обновляет строку", async () => {
    const user = await createUser({
      telegramId: 4242,
      name: "Заблокированный",
      lastLoginAt: null,
    });
    await db().update(users).set({ isBlocked: true }).where(eq(users.id, user.id));

    const result = await loginViaTelegram();

    expect(result.steps[2].status).toBe(302);
    expect(result.steps[2].headers.get("location")).toBe(
      `${inject("appUrl")}/login?error=blocked`,
    );
    expect(result.cookie).toBeNull();

    const [row] = await db().select().from(users).where(eq(users.id, user.id));
    expect(row.name).toBe("Заблокированный");
    expect(row.lastLoginAt).toBeNull();
    expect(await db().select().from(authSessions)).toHaveLength(0);
  });
});

describe("POST /api/auth/logout", () => {
  test("удаляет сессию и cookie", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await fetchApp("/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cleared = requireSetCookie(response, "studio_session");
    expect(cookieAttribute(cleared, "Max-Age")).toBe("0");

    expect(await db().select().from(authSessions)).toHaveLength(0);
    expect((await fetchApp("/api/auth/me", { headers: { cookie } })).status).toBe(401);
  });

  test("без cookie тоже 204", async () => {
    const response = await fetchApp("/api/auth/logout", { method: "POST" });

    expect(response.status).toBe(204);
  });

  test("чужой Origin — 403, сессия жива", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await fetchApp("/api/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "forbidden", message: "Доступ закрыт" },
    });
    expect(await db().select().from(authSessions)).toHaveLength(1);
    expect((await fetchApp("/api/auth/me", { headers: { cookie } })).status).toBe(200);
  });
});

describe("страница /login", () => {
  test("вошедшего перенаправляет на next", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await fetchApp("/login?next=%2Fs%2Fsession-1", { headers: { cookie } });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/s/session-1");
  });

  test("заблокированному показывает сообщение, не перенаправляя", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);
    await db().update(users).set({ isBlocked: true }).where(eq(users.id, user.id));

    const response = await fetchApp("/login", { headers: { cookie } });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      "Доступ к сервису закрыт для этого аккаунта. Если это ошибка, напишите владельцу сервиса.",
    );
  });

  test("показывает сообщение о неудачном входе", async () => {
    const response = await fetchApp("/login?error=failed");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      "Не удалось войти через Telegram. Вход мог быть отменён или устареть, попробуйте ещё раз.",
    );
  });
});

describe("заголовки", () => {
  test("GET /api/auth/me содержит COOP и no-store", async () => {
    const user = await createUser();
    const cookie = await loginAs(user);

    const response = await fetchApp("/api/auth/me", { headers: { cookie } });

    expect(response.headers.get("cross-origin-opener-policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
