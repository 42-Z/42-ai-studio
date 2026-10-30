import { expect, test } from "vitest";

import { SessionsEmptyState } from "@/components/studio/sessions-empty-state";
import { AppShell } from "@/components/studio/app-shell";
import { navItems } from "@/components/studio/nav";

import { renderOnDesktop } from "./support/render";

test("пустое состояние /s объясняет, что сессий нет", async () => {
  const screen = await renderOnDesktop(
    <AppShell navItems={navItems} pathname="/s">
      <SessionsEmptyState />
    </AppShell>,
  );

  await expect.element(screen.getByText("Сессий пока нет")).toBeVisible();
});
