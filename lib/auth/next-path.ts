/**
 * Куда вернуть пользователя после входа. Принимается только локальный путь:
 * чужие адреса (`//evil.example`, `https://evil.example`) и обратные косые
 * превратили бы вход в открытый редирект.
 */
export const DEFAULT_NEXT_PATH = "/s";

const MAX_NEXT_PATH_LENGTH = 512;

export function safeNextPath(value: string | null | undefined): string {
  if (value === null || value === undefined) return DEFAULT_NEXT_PATH;
  if (value.length === 0 || value.length > MAX_NEXT_PATH_LENGTH) return DEFAULT_NEXT_PATH;
  if (!value.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (value.includes("//")) return DEFAULT_NEXT_PATH;
  if (value.includes("\\")) return DEFAULT_NEXT_PATH;
  // Управляющие символы ломают заголовок Location.
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_NEXT_PATH;
  // Возврат на страницу входа или в API сделал бы петлю после входа.
  const pathname = value.split(/[?#]/, 1)[0] ?? value;
  if (pathname === "/login" || pathname.startsWith("/login/")) return DEFAULT_NEXT_PATH;
  if (pathname === "/api" || pathname.startsWith("/api/")) return DEFAULT_NEXT_PATH;
  return value;
}
