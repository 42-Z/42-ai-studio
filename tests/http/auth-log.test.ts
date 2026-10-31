/** Журнал приложения не должен содержать секретов и выданных значений входа. */
import { beforeEach, expect, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { appOutput } from "./support/app";
import { loginViaTelegram } from "./support/auth";
import { resetDatabase } from "./support/db";
import { telegramStub } from "./support/telegram";

beforeEach(async () => {
  await telegramStub.reset();
  await resetDatabase();
});

test("вывод приложения за время тестов не содержит секретов, id_token и токена cookie", async () => {
  const result = await loginViaTelegram();
  const config = loadConfig();
  const issued = await telegramStub.lastIssued();
  const token = result.cookie?.split("=")[1];

  expect(issued).not.toBeNull();
  expect(token).toBeDefined();

  const output = appOutput();
  expect(output).not.toContain(config.sessionSecret);
  expect(output).not.toContain(issued!.idToken);
  expect(output).not.toContain(token!);
});
