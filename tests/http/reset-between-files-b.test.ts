/** Вторая половина пары, см. `reset-between-files-a.test.ts`. */
import { describe, expect, test } from "vitest";

import { createUser, userCount } from "./support/db";
import { s3 } from "./support/s3";

describe("очистка перед файлом (B)", () => {
  test("файл начинается с пустых таблицы users и бакета", async () => {
    expect(await userCount()).toBe(0);
    expect(await s3().listKeys("")).toEqual([]);
  });

  test("оставляет после себя пользователя и объект", async () => {
    await createUser();
    await s3().put("u/reset-b/s/x/uploads/1/b.txt", "b", "text/plain");

    expect(await userCount()).toBe(1);
  });
});
