/**
 * Конфигурация drizzle-kit: схема, каталог миграций и строка подключения.
 * `DATABASE_URL` берётся через модуль конфигурации — это не исключение
 * из правила про `process.env`.
 */
import { defineConfig } from "drizzle-kit";

import { loadConfig } from "./lib/config";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: loadConfig().databaseUrl,
  },
});
