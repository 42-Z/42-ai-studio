import { expect, test } from "vitest";

import { PublicShell } from "@/components/studio/public-shell";

import { renderOnDesktop } from "./support/render";

test("русский текст отрисован Geist с кириллическим подмножеством", async () => {
  await renderOnDesktop(
    <PublicShell>
      <p>Привет</p>
    </PublicShell>,
  );

  const faces = await document.fonts.load('16px "Geist Variable"', "Привет");
  const cyrillic = faces.find((face) => face.unicodeRange.includes("U+400-45F"));

  expect(cyrillic).toBeDefined();
  expect(cyrillic?.status).toBe("loaded");
  expect(getComputedStyle(document.body).fontFamily).toContain("Geist Variable");
});
