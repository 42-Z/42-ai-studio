/**
 * Жизненный цикл экземпляров: остановка при отсутствующей переменной и
 * параллельная работа двух `next dev` без конфликта `.next/dev/lock`.
 */
import { inject } from "vitest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { fetchApp, startApp, type AppHandle } from "./support/app";

describe("отсутствующая переменная останавливает запуск", () => {
  let app: AppHandle;

  beforeAll(async () => {
    app = await startApp({ env: { DATABASE_URL: "" }, expectExit: true });
  });

  test("процесс завершается с ненулевым кодом", async () => {
    expect(await app.exited).not.toBe(0);
  });

  test("вывод называет переменную", () => {
    expect(app.output()).toContain("DATABASE_URL");
  });
});

describe("два экземпляра работают одновременно", () => {
  let second: AppHandle;

  beforeAll(async () => {
    second = await startApp();
  });

  afterAll(async () => {
    await second.stop();
  });

  test("основной экземпляр отвечает", async () => {
    const response = await fetchApp("/api/health");

    expect(response.status).toBe(200);
  });

  test("второй экземпляр отвечает со своего порта", async () => {
    const response = await fetch(`${second.url}/api/health`, { redirect: "manual" });

    expect(second.port).not.toBe(Number(new URL(inject("appUrl")).port));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { database: "ok", storage: "ok" },
    });
  });
});
