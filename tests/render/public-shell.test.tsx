import { expect, test } from "vitest";
import { page } from "vitest/browser";

import { PublicShell } from "@/components/studio/public-shell";

import { expectNoHorizontalScroll, renderOnDesktop, renderOnPhone } from "./support/render";

test("публичный каркас не прокручивается по горизонтали на телефоне", async () => {
  await renderOnPhone(
    <PublicShell>
      <p>Привет</p>
    </PublicShell>,
  );

  await expect.element(page.getByText("Привет")).toBeVisible();
  expectNoHorizontalScroll();
});

test("публичный каркас не прокручивается по горизонтали на компьютере", async () => {
  await renderOnDesktop(
    <PublicShell>
      <p>Привет</p>
    </PublicShell>,
  );

  await expect.element(page.getByText("Привет")).toBeVisible();
  expectNoHorizontalScroll();
});
