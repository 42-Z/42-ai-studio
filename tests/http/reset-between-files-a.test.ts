/**
 * Пара файлов `reset-between-files-a` и `-b` доказывает, что `setupFiles`
 * подключён: каждый в начале видит пустые `users` и бакет, ничего не очищая
 * сам, а в конце оставляет пользователя и объект. Какой бы файл ни шёл вторым,
 * он увидит пустоту, только если очистка перед файлом сработала.
 */
import { describe, expect, test } from "vitest";

import { createUser, userCount } from "./support/db";
import { s3 } from "./support/s3";

describe("очистка перед файлом (A)", () => {
  test("файл начинается с пустых таблицы users и бакета", async () => {
    expect(await userCount()).toBe(0);
    expect(await s3().listKeys("")).toEqual([]);
  });

  test("оставляет после себя пользователя и объект", async () => {
    await createUser();
    await s3().put("u/reset-a/s/x/uploads/1/a.txt", "a", "text/plain");

    expect(await userCount()).toBe(1);
  });
});
