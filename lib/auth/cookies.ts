/** Имена и атрибуты cookie сессии и незавершённого входа OIDC. */

import { NONCE_TTL_SECONDS } from "./nonce";

export const SESSION_COOKIE = "studio_session";
export const OIDC_COOKIE = "studio_oidc";

export interface CookieAttributes {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly path: string;
  readonly secure: boolean;
  readonly maxAge: number;
}

/**
 * `Secure` ставится только для https-адреса: на `http://localhost` браузер
 * не отправит такую cookie обратно.
 */
export function usesSecureCookies(appUrl: string): boolean {
  return appUrl.startsWith("https://");
}

/** Cookie сессии входа: срок совпадает со сроком строки `auth_sessions`. */
export function sessionCookieAttributes(appUrl: string, ttlDays: number): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: usesSecureCookies(appUrl),
    maxAge: ttlDays * 24 * 60 * 60,
  };
}

export function oidcCookieAttributes(appUrl: string): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/telegram",
    secure: usesSecureCookies(appUrl),
    maxAge: NONCE_TTL_SECONDS,
  };
}

export function clearedOidcCookieAttributes(appUrl: string): CookieAttributes {
  return { ...oidcCookieAttributes(appUrl), maxAge: 0 };
}
