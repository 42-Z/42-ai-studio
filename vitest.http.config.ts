/**
 * HTTP-тесты: запускают настоящее приложение и ходят в него по HTTP.
 * Запуск — одной командой `npm run test:http` после `docker compose up -d`.
 */
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Тот же псевдоним, что у приложения: канал eve импортирует серверные
    // модули через `@/`, и тесты читают этот файл напрямую.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/http/**/*.test.ts"],
    globalSetup: ["tests/http/global-setup.ts"],
    // Перед каждым файлом: resetDatabase() и очистка бакета.
    setupFiles: ["tests/http/setup.ts"],
    // resetDatabase() перед каждым файлом требует последовательного прогона.
    fileParallelism: false,
    // Холодный старт next dev вместе с eve занимает до 180 с.
    hookTimeout: 240_000,
    testTimeout: 30_000,
    teardownTimeout: 60_000,
  },
});
