/**
 * Единый формат ошибок HTTP-маршрутов: `{"error":{"code","message"}}`.
 * Ответы, которые не стоит кэшировать, помечаются `Cache-Control: no-store`.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export function apiErrorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(apiErrorBody(code, message), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
