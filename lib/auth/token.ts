/** Токены сессии: в cookie едет случайный токен, в базе — только его хеш. */
import { createHash, randomBytes } from "node:crypto";

/** 32 случайных байта в base64url — 43 символа. */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 токена в hex: по нему ищется строка `auth_sessions`. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
