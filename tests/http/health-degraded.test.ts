/**
 * Ответ /api/health при недоступных зависимостях. Отличия касаются только
 * Next.js-части, поэтому экземпляры идут рядом с основным.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";

import { startApp, type AppHandle } from "./support/app";

/** Порт из диапазона заглушек внешних сервисов: на нём никто не слушает. */
const CLOSED_PORT = 59199;

describe("health при недоступном хранилище", () => {
  let app: AppHandle;

  beforeAll(async () => {
    app = await startApp({ env: { S3_ENDPOINT: `http://localhost:${CLOSED_PORT}` } });
  });

  afterAll(async () => {
    await app.stop();
  });

  test("GET /api/health отвечает 503 и называет проверку storage", async () => {
    const response = await fetch(`${app.url}/api/health`, { redirect: "manual" });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      checks: { database: "ok", storage: "error" },
    });
  });

  test("в теле нет текста исключений, а журнал называет проверку", async () => {
    const response = await fetch(`${app.url}/api/health`, { redirect: "manual" });
    const body = await response.text();

    expect(body).not.toMatch(/Error|стек|stack|at \w/);
    expect(app.output()).toContain("storage");
  });
});

describe("health при недоступной базе", () => {
  let app: AppHandle;

  beforeAll(async () => {
    app = await startApp({
      env: { DATABASE_URL: `postgres://studio:studio@localhost:${CLOSED_PORT}/studio_test` },
    });
  });

  afterAll(async () => {
    await app.stop();
  });

  test("GET /api/health отвечает 503 и называет проверку database", async () => {
    const response = await fetch(`${app.url}/api/health`, { redirect: "manual" });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      checks: { database: "error", storage: "ok" },
    });
    expect(app.output()).toContain("database");
  });
});
