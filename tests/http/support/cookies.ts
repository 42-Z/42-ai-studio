/** Разбор `Set-Cookie` в тестах: один набор помощников на все файлы. */

/** Заголовок `Set-Cookie` с нужным именем cookie. */
export function setCookieHeader(response: Response, name: string): string | null {
  return (
    response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`)) ?? null
  );
}

/** То же, но отсутствие cookie — ошибка теста. */
export function requireSetCookie(response: Response, name: string): string {
  const header = setCookieHeader(response, name);
  if (header === null) throw new Error(`ответ не содержит cookie ${name}`);
  return header;
}

/** Пара `имя=значение` для заголовка `Cookie`. */
export function cookiePair(response: Response, name: string): string | null {
  return setCookieHeader(response, name)?.split(";")[0] ?? null;
}

/** Значение атрибута `Set-Cookie` без учёта регистра. */
export function cookieAttribute(header: string, name: string): string | null {
  const match = header.match(new RegExp(`;\\s*${name}=([^;]*)`, "i"));
  return match?.[1] ?? null;
}

/** Есть ли у cookie флаг без значения (`HttpOnly`, `Secure`). */
export function hasCookieAttribute(header: string, name: string): boolean {
  return new RegExp(`;\\s*${name}(?:=|;|$)`, "i").test(header);
}
