/**
 * GET /api/auth/dev-login — вход без Telegram для локальной разработки.
 * Вне `DEV_LOGIN_ENABLED` маршрута как будто нет: 404.
 */
import type { NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  sessionCookieAttributes,
} from "@/lib/auth/cookies";
import { checkOrigin } from "@/lib/auth/guard";
import { logAuthFailure } from "@/lib/auth/log";
import { truncateName } from "@/lib/auth/name";
import { AuthFlowError } from "@/lib/auth/oidc";
import { redirectResponse } from "@/lib/auth/routes";
import { createUserSession, grantOperator, upsertLocalUser } from "@/lib/auth/service";
import { loadConfig } from "@/lib/config";
import { errorResponse } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const config = loadConfig();

  if (!config.devLoginEnabled || process.env.NODE_ENV === "production") {
    return errorResponse(404, "not_found", "Страница не найдена");
  }

  const originError = checkOrigin(request, config.appUrl);
  if (originError !== null) return originError;

  const search = request.nextUrl.searchParams;
  const rawId = search.get("telegramId") ?? "";
  if (!/^\d+$/.test(rawId)) {
    return errorResponse(400, "bad_request", "telegramId должен быть положительным целым числом");
  }
  const telegramId = Number(rawId);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return errorResponse(400, "bad_request", "telegramId должен быть положительным целым числом");
  }

  const requestedName = search.get("name")?.trim();
  const name = truncateName(
    requestedName === undefined || requestedName.length === 0
      ? `Пользователь ${telegramId}`
      : requestedName,
  );

  try {
    const result = await upsertLocalUser({ telegramId, name });
    if (result.blocked) {
      logAuthFailure("dev-login", new AuthFlowError("user_blocked"));
      return redirectResponse(config.appUrl, "/login?error=blocked");
    }

    const user =
      search.get("operator") === "1" && !result.user.isOperator
        ? await grantOperator(result.user.id)
        : result.user;

    const sessionToken = await createUserSession(user.id, config.sessionTtlDays);
    const response = redirectResponse(config.appUrl, "/s");
    response.cookies.set(
      SESSION_COOKIE,
      sessionToken,
      sessionCookieAttributes(config.appUrl, config.sessionTtlDays),
    );
    return response;
  } catch (error) {
    logAuthFailure("dev-login", error);
    return errorResponse(500, "internal_error", "Не удалось войти");
  }
}
