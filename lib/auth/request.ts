/** Чтение cookie и пользователя из обычного `Request` — годится и для eve. */
import type { User } from "../db/schema";
import { SESSION_COOKIE } from "./cookies";
import { getUserBySessionToken } from "./service";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

/** Пользователь по cookie сессии; `null` — входа нет или сессия просрочена. */
export function getUserFromRequest(request: Request): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null || token.length === 0) return Promise.resolve(null);
  return getUserBySessionToken(token);
}
