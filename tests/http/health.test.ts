/** Проверки здоровья основного экземпляра. */
import { inject } from "vitest";
import { describe, expect, test } from "vitest";

import { loadConfig } from "../../lib/config";
import { appOutput, fetchApp } from "./support/app";

describe("health основного экземпляра", () => {
  test("GET /api/health отвечает 200 и полной сводкой", async () => {
    const response = await fetchApp("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { database: "ok", storage: "ok" },
    });
  });

  test("GET /eve/v1/health отвечает 200 и ok: true", async () => {
    const response = await fetchApp("/eve/v1/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  test("адрес приложения совпадает с переданным через inject", () => {
    expect(inject("appUrl")).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test("вывод приложения не содержит секретов", () => {
    const config = loadConfig();
    const output = appOutput();
    const secrets = [
      config.s3SecretAccessKey,
      config.s3AccessKeyId,
      config.databaseUrl,
    ].filter((value) => value.length > 0);

    for (const secret of secrets) {
      expect(output).not.toContain(secret);
    }
  });
});
