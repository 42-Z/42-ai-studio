/** Журнал приложения не должен содержать секретов и выданных значений входа. */
import { beforeEach, expect, inject, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { appOutput } from "./support/app";
import { loginViaTelegram } from "./support/auth";
import { cookiePair } from "./support/cookies";
import { resetDatabase } from "./support/db";
import { telegramStub } from "./support/telegram";

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

test("успешный вход не раскрывает в журнале секреты, code, id_token и cookie", async () => {
  const result = await loginViaTelegram();
  const callback = result.steps[2];
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe(`${inject("appUrl")}/s`);
  expect(cookiePair(callback, "studio_session")).not.toBeNull();
  if (result.cookie === null) throw new Error("успешный вход не выдал cookie сессии");

  const config = loadConfig();
  const issued = await telegramStub.lastIssued();
  if (issued === null) throw new Error("успешный вход не обменял код у издателя");
  const token = result.cookie.slice("studio_session=".length);

  const output = appOutput();
  const sensitiveValues = {
    clientSecret: config.telegramClientSecret,
    sessionSecret: config.sessionSecret,
    code: issued.code,
    idToken: issued.idToken,
    cookie: result.cookie,
    sessionToken: token,
  };
  for (const [name, value] of Object.entries(sensitiveValues)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`не получено тестовое значение ${name} для проверки журнала`);
    }
    // Даже при провале проверки само значение не попадёт в отчёт Vitest.
    expect(output.includes(value), `${name} не должен попадать в журнал`).toBe(false);
  }
});
