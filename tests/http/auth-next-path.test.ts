/** Страница входа принимает в `?next=` только локальные пути. */
import { expect, test } from "vitest";

import { fetchApp } from "./support/app";
import { loginAs } from "./support/auth";
import { createUser } from "./support/db";

test.each(["/s", "/s/session-1?tab=video"])("принимает локальный путь %s", async (next) => {
  const cookie = await loginAs(await createUser());
  const response = await fetchApp(`/login?next=${encodeURIComponent(next)}`, {
    headers: { cookie },
  });

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(next);
});

test.each([
  "//evil.example",
  "https://evil.example",
  "/\\evil",
  "evil",
  "",
  "/s\u0000x",
  `/${"a".repeat(512)}`,
  "/login",
  "/login?next=%2Fs",
  "/api/auth/me",
])("небезопасный next %j возвращает на /s", async (next) => {
  const cookie = await loginAs(await createUser());
  const response = await fetchApp(`/login?next=${encodeURIComponent(next)}`, {
    headers: { cookie },
  });

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("/s");
});
