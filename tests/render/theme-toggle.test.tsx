import { beforeEach, expect, test } from "vitest";
import { commands, page } from "vitest/browser";

import { ThemeToggle } from "@/components/studio/theme-toggle";

import { renderOnDesktop } from "./support/render";

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
  await commands.emulateColorScheme("light");
});

async function chooseTheme(title: "Светлая" | "Тёмная" | "Системная") {
  await page.getByRole("button", { name: "Тема" }).click();

  const option = page.getByRole("menuitemradio", { name: title });
  await expect.element(option).toBeVisible();
  await option.click();
  await expect.element(option).not.toBeInTheDocument();
}

test("переключатель ведёт класс dark и запоминает выбор", async () => {
  const first = await renderOnDesktop(<ThemeToggle />);

  await chooseTheme("Светлая");
  await expect.poll(() => localStorage.getItem("theme")).toBe("light");
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);

  await chooseTheme("Тёмная");
  await expect.poll(() => localStorage.getItem("theme")).toBe("dark");
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);

  await first.unmount();
  document.documentElement.classList.remove("light", "dark");

  await renderOnDesktop(<ThemeToggle />);
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
});

test("системная тема следует за цветовой схемой браузера", async () => {
  await commands.emulateColorScheme("dark");
  await renderOnDesktop(<ThemeToggle />);

  await chooseTheme("Системная");
  await expect.poll(() => localStorage.getItem("theme")).toBe("system");
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);

  await commands.emulateColorScheme("light");
  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);
});
