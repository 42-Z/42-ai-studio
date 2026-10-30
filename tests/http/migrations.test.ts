/**
 * Миграции: повторное применение ничего не меняет; `resetDatabase()` чистит
 * `users` и не трогает журнал миграций.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";

import {
  createUser,
  migrationJournalCount,
  resetDatabase,
  userCount,
} from "./support/db";

const execFileAsync = promisify(execFile);

describe("повторное применение миграций", () => {
  test("npm run db:migrate проходит и не добавляет строк в журнал", async () => {
    const before = await migrationJournalCount();

    // Миграции уже применены глобальной подготовкой — повтор ждём без изменений.
    await execFileAsync("npm", ["run", "db:migrate"], { cwd: process.cwd() });
    await execFileAsync("npm", ["run", "db:migrate"], { cwd: process.cwd() });

    expect(await migrationJournalCount()).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  test("resetDatabase оставляет users пустой и не трогает журнал", async () => {
    await createUser();
    await createUser();
    expect(await userCount()).toBe(2);

    const journal = await migrationJournalCount();
    await resetDatabase();

    expect(await userCount()).toBe(0);
    expect(await migrationJournalCount()).toBe(journal);
  });
});
