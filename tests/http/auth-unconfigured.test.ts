/** Приложение без настроенного Telegram: страница входа и начало потока. */
import { afterAll, beforeAll, expect, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { startApp, type AppHandle } from "./support/app";
import { setCookieHeader } from "./support/cookies";

let app: AppHandle;

beforeAll(async () => {
  app = await startApp({
    env: {
      TELEGRAM_CLIENT_ID: undefined,
      TELEGRAM_CLIENT_SECRET: undefined,
      DEV_LOGIN_ENABLED: "0",
    },
  });
});

afterAll(async () => {
  await app.stop();
});

test("страница входа предупреждает, что вход не настроен", async () => {
  const response = await fetch(`${app.url}/login`, { redirect: "manual" });
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body).toContain("Вход не настроен");
  expect(body).not.toContain("Войти через Telegram");
  expect(body).not.toContain("Войти как разработчик");
});

test("начало входа без Telegram ведёт на error=failed", async () => {
  const response = await fetch(`${app.url}/api/auth/telegram/login?next=%2Fs`, {
    redirect: "manual",
  });

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${loadConfig().appUrl}/login?error=failed`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(setCookieHeader(response, "studio_session")).toBeNull();
  expect(setCookieHeader(response, "studio_oidc")).toBeNull();
});
