/** Тесты работают только с базой `*_test` — проверка этого правила. */
import { describe, expect, test } from "vitest";

import { assertTestDatabaseName, databaseName } from "./support/db";

describe("защита от работы с рабочей базой", () => {
  test("отказывается работать с базой, имя которой не оканчивается на _test", () => {
    expect(() => assertTestDatabaseName("postgres://studio:studio@localhost:55432/studio_dev"))
      .toThrow(/_test/);
    expect(() => assertTestDatabaseName("postgres://studio:studio@localhost:55432/studio"))
      .toThrow(/_test/);
  });

  test("пропускает базу с именем *_test", () => {
    expect(() =>
      assertTestDatabaseName("postgres://studio:studio@localhost:55432/studio_test"),
    ).not.toThrow();
  });

  test("имя базы извлекается из URL", () => {
    expect(databaseName("postgres://studio:studio@localhost:55432/studio_test")).toBe("studio_test");
    expect(databaseName("postgres://studio:studio@localhost:55432/a%20b")).toBe("a b");
  });
});
