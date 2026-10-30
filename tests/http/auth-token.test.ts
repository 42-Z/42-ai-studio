/** Токены сессии: формат и независимая проверка хеша. */
import { expect, test } from "vitest";

import { createSessionToken, hashSessionToken } from "../../lib/auth/token";

test("SHA-256 токена — hex, известный вектор", () => {
  // Значение посчитано независимо: printf 'test-token' | sha256sum
  expect(hashSessionToken("test-token")).toBe(
    "4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e",
  );
});

test("токен — 32 случайных байта в base64url", () => {
  const tokens = new Set(Array.from({ length: 20 }, () => createSessionToken()));

  expect(tokens.size).toBe(20);
  for (const token of tokens) {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  }
});
