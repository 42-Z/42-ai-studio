/**
 * Канал eve: единственный аутентификатор — наша серверная сессия входа.
 * `localDev()`, `vercelOidc()` и `placeholderAuth()` не подключаются: иначе
 * тесты доступа ничего бы не доказывали.
 *
 * Проверка пользователя и проверка доступа к маршруту — отдельные шаги,
 * чтобы #5 мог добавить к ним принадлежность сессии без переписывания.
 */
import { ForbiddenError, type AuthFn, type AuthResult } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

import { getUserFromRequest } from "@/lib/auth/request";
import { loadConfig } from "@/lib/config";
import type { User } from "@/lib/db/schema";

const INFO_ROUTE_PATH = "/eve/v1/info";

/** Кто пришёл: пользователь по cookie `studio_session` или никто. */
async function resolveAuthenticatedUser(request: Request): Promise<User | null> {
  return getUserFromRequest(request);
}

/**
 * Что этому пользователю разрешено на маршруте. Инструкции, инструменты и
 * навыки агента видит только оператор.
 */
function assertRouteAllowed(user: User, request: Request): void {
  if (user.isBlocked) {
    throw new ForbiddenError({ code: "user_blocked", message: "Доступ закрыт" });
  }

  const pathname = new URL(request.url).pathname;
  if (pathname === INFO_ROUTE_PATH && !user.isOperator) {
    throw new ForbiddenError({ code: "forbidden", message: "Доступ закрыт" });
  }
}

/** Принципал eve для пользователя; подмены инструментов — только в тестах. */
export function sessionAuthFor(user: User, appTestMode: boolean): AuthResult {
  return {
    authenticator: "studio",
    principalType: "user",
    principalId: user.id,
    attributes: { telegramId: String(user.telegramId) },
    ...(appTestMode ? { allowToolStubs: true } : {}),
  };
}

export function studioAuth(): AuthFn<Request> {
  return async (request): Promise<AuthResult | null> => {
    const user = await resolveAuthenticatedUser(request);
    if (user === null) return null;

    assertRouteAllowed(user, request);

    return sessionAuthFor(user, loadConfig().appTestMode);
  };
}

export default eveChannel({ auth: [studioAuth()] });
