/**
 * GET /api/auth/telegram/callback — возврат из Telegram: проверка контейнера
 * и `state`, обмен кода, проверка `id_token`, пользователь и cookie сессии.
 * Любой сбой — 302 на `/login?error=failed`; заблокирован — `error=blocked`,
 * cookie сессии при этом не ставится.
 */
import type { NextRequest, NextResponse } from "next/server";

import {
  OIDC_COOKIE,
  SESSION_COOKIE,
  clearedOidcCookieAttributes,
  sessionCookieAttributes,
} from "@/lib/auth/cookies";
import { logAuthFailure } from "@/lib/auth/log";
import { safeNextPath } from "@/lib/auth/next-path";
import { AuthFlowError, assertNoProviderError, completeLogin } from "@/lib/auth/oidc";
import { redirectResponse } from "@/lib/auth/routes";
import { requireOidcSettings } from "@/lib/auth/settings";
import { createUserSession, upsertTelegramUser } from "@/lib/auth/service";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const config = loadConfig();

  const clearOidc = (path: string): NextResponse => {
    const response = redirectResponse(config.appUrl, path);
    response.cookies.set(OIDC_COOKIE, "", clearedOidcCookieAttributes(config.appUrl));
    return response;
  };

  const containerToken = request.cookies.get(OIDC_COOKIE)?.value;
  if (containerToken === undefined || containerToken.length === 0) {
    logAuthFailure("callback", new AuthFlowError("no_oidc_cookie"));
    return clearOidc("/login?error=failed");
  }

  try {
    const search = request.nextUrl.searchParams;
    assertNoProviderError(search.get("error"));

    const code = search.get("code");
    const state = search.get("state");
    if (code === null || code.length === 0 || state === null || state.length === 0) {
      throw new AuthFlowError("no_code");
    }

    const { profile, next } = await completeLogin(requireOidcSettings(config), {
      code,
      state,
      containerToken,
      sessionSecret: config.sessionSecret,
    });

    const result = await upsertTelegramUser(profile);
    if (result.blocked) {
      logAuthFailure("callback", new AuthFlowError("user_blocked"));
      return clearOidc("/login?error=blocked");
    }

    const sessionToken = await createUserSession(result.user.id, config.sessionTtlDays);

    const response = redirectResponse(config.appUrl, safeNextPath(next));
    response.cookies.set(
      SESSION_COOKIE,
      sessionToken,
      sessionCookieAttributes(config.appUrl, config.sessionTtlDays),
    );
    response.cookies.set(OIDC_COOKIE, "", clearedOidcCookieAttributes(config.appUrl));
    return response;
  } catch (error) {
    logAuthFailure("callback", error);
    return clearOidc("/login?error=failed");
  }
}
