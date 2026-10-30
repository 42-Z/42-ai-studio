import { expect, test } from "vitest";
import { page } from "vitest/browser";

import { AppShell } from "@/components/studio/app-shell";
import { navItems } from "@/components/studio/nav";

import { expectNoHorizontalScroll, renderOnDesktop, renderOnPhone } from "./support/render";

function shell(pathname = "/s") {
  return (
    <AppShell navItems={navItems} pathname={pathname}>
      Содержимое
    </AppShell>
  );
}

test("на компьютере боковая панель и пункт «Сессии» видны", async () => {
  await renderOnDesktop(shell());

  await expect.element(page.getByText("Сессии")).toBeVisible();
  await expect.element(page.getByText("42 AI Studio").first()).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /меню/, includeHidden: true }))
    .not.toBeVisible();
});

test("на телефоне панель скрыта и открывается кнопкой в верхней строке", async () => {
  await renderOnPhone(shell());

  const trigger = page.getByRole("button", { name: /меню/ });
  await expect.element(trigger).toBeVisible();
  await expect.element(page.getByText("Сессии")).not.toBeInTheDocument();

  await trigger.click();

  await expect.element(page.getByText("Сессии")).toBeVisible();
  await expect.element(page.getByRole("dialog")).toBeVisible();
});

test("активный пункт отмечается по текущему пути", async () => {
  await renderOnDesktop(shell("/s/session-1"));

  await expect.element(page.getByRole("link", { name: "Сессии" })).toHaveAttribute(
    "data-active",
  );
});

test("каркас приложения не прокручивается по горизонтали на телефоне", async () => {
  await renderOnPhone(shell());
  expectNoHorizontalScroll();
});

test("каркас приложения не прокручивается по горизонтали на компьютере", async () => {
  await renderOnDesktop(shell());
  expectNoHorizontalScroll();
});
