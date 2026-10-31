/** Ответы маршрутов входа: редиректы строятся от `APP_URL`, не от `Host`. */
import { NextResponse } from "next/server";

/** Абсолютный адрес приложения; второй аргумент — путь или полный URL. */
export function absoluteUrl(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl);
}

/** Редирект `302` (не `307`, который отдаёт `redirect()` по умолчанию). */
export function redirectResponse(baseUrl: string, path: string, status = 302): NextResponse {
  const response = NextResponse.redirect(absoluteUrl(baseUrl, path), status);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
