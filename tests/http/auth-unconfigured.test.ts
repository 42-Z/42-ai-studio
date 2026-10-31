/** Приложение без настроенного Telegram: страница входа и начало потока. */
import { afterAll, beforeAll, expect, test } from "vitest";

import { startApp, type AppHandle } from "./support/app";

let app: AppHandle;

beforeAll(async () => {
  app = await startApp({
    env: {
      TELEGRAM_CLIENT_ID: undefined,
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

test("начало входа без Telegram отвечает 404", async () => {
  const response = await fetch(`${app.url}/api/auth/telegram/nonce`, {
    method: "POST",
    redirect: "manual",
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: { code: "not_found", message: "Страница не найдена" },
  });
});
