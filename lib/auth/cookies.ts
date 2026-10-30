/** Имена и атрибуты cookie входа: единственное место, где они заданы. */

export const SESSION_COOKIE = "studio_session";
export const OIDC_COOKIE = "studio_oidc";
export const OIDC_COOKIE_PATH = "/api/auth/telegram";

/** Срок жизни контейнера входа: 10 минут. */
export const OIDC_COOKIE_MAX_AGE = 600;

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

/** Cookie незавершённого входа. */
export function oidcCookieAttributes(appUrl: string): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: OIDC_COOKIE_PATH,
    secure: usesSecureCookies(appUrl),
    maxAge: OIDC_COOKIE_MAX_AGE,
  };
}

/**
 * Удаление cookie с тем же путём, что и при установке: `delete()` поставил бы
 * `Path=/`, и cookie на `/api/auth/telegram` осталась бы.
 */
export function clearedOidcCookieAttributes(appUrl: string): CookieAttributes {
  return { ...oidcCookieAttributes(appUrl), maxAge: 0 };
}
