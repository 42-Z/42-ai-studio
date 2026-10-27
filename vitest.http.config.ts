/**
 * HTTP-тесты: запускают настоящее приложение и ходят в него по HTTP.
 * Запуск — одной командой `npm run test:http` после `docker compose up -d`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/http/**/*.test.ts"],
    globalSetup: ["tests/http/global-setup.ts"],
    // resetDatabase() перед каждым файлом требует последовательного прогона.
    fileParallelism: false,
    // Холодный старт next dev вместе с eve занимает до 180 с.
    hookTimeout: 240_000,
    testTimeout: 30_000,
    teardownTimeout: 60_000,
  },
});
