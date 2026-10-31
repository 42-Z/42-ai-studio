/**
 * Возврат из Telegram: cookie и state, обмен кода, JWT и серверная сессия.
 * Временная cookie очищается при любом исходе.
 */
import { NextResponse, type NextRequest } from "next/server";

import {
  OIDC_COOKIE,
  SESSION_COOKIE,
  clearedOidcCookieAttributes,
  sessionCookieAttributes,
} from "@/lib/auth/cookies";
import { checkOrigin } from "@/lib/auth/guard";
import { logAuthFailure } from "@/lib/auth/log";
import { safeNextPath } from "@/lib/auth/next-path";
import { AuthFlowError, completeLogin } from "@/lib/auth/oidc";
import { redirectResponse } from "@/lib/auth/routes";
import { requireOidcSettings } from "@/lib/auth/settings";
import { createUserSession, upsertTelegramUser } from "@/lib/auth/service";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const config = loadConfig();
  const originError = checkOrigin(request, config.appUrl);
  if (originError !== null) {
    const response = new NextResponse(originError.body, originError);
    response.cookies.set(OIDC_COOKIE, "", clearedOidcCookieAttributes(config.appUrl));
    return response;
  }
  const redirectAndClear = (path: string): NextResponse => {
    const response = redirectResponse(config.appUrl, path);
    response.cookies.set(OIDC_COOKIE, "", clearedOidcCookieAttributes(config.appUrl));
    return response;
  };

  try {
    const search = request.nextUrl.searchParams;
    if (search.has("error")) throw new AuthFlowError("provider_error");
    const code = search.get("code");
    const state = search.get("state");
    if (!code || !state) throw new AuthFlowError("no_code");
    const containerToken = request.cookies.get(OIDC_COOKIE)?.value;
    if (!containerToken) throw new AuthFlowError("no_oidc_cookie");

    const { profile, next } = await completeLogin(requireOidcSettings(config), {
      code,
      state,
      containerToken,
      sessionSecret: config.sessionSecret,
    });

    const result = await upsertTelegramUser(profile);
    if (result.blocked) {
      logAuthFailure("callback", new AuthFlowError("user_blocked"));
      return redirectAndClear("/login?error=blocked");
    }

    const sessionToken = await createUserSession(result.user.id, config.sessionTtlDays);

    const response = redirectAndClear(safeNextPath(next));
    response.cookies.set(
      SESSION_COOKIE,
      sessionToken,
      sessionCookieAttributes(config.appUrl, config.sessionTtlDays),
    );
    return response;
  } catch (error) {
    logAuthFailure("callback", error);
    return redirectAndClear("/login?error=failed");
  }
}
