/**
 * Тесты отрисовки: настоящий Chromium, компоненты React и те же глобальные
 * стили, что у приложения. Запуск — `npm run test:render`.
 * Браузер ставится командой `npx playwright install chromium` (см. README).
 */
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

/** Эмуляция системной цветовой схемы через настройки страницы Playwright. */
const emulateColorScheme: BrowserCommand<["light" | "dark"]> = async (
  context,
  colorScheme,
) => {
  if (context.provider.name !== "playwright") {
    throw new Error("Эмуляция цветовой схемы доступна только с провайдером Playwright");
  }

  await context.page.emulateMedia({ colorScheme });
};

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark") => Promise<void>;
  }
}

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/render/**/*.test.tsx"],
    setupFiles: ["tests/render/setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
      commands: { emulateColorScheme },
    },
  },
});
