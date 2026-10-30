/**
 * GET /api/auth/telegram/login — начало входа: PKCE, state, nonce и cookie
 * `studio_oidc`, затем редирект на авторизацию Telegram.
 */
import type { NextRequest } from "next/server";

import { OIDC_COOKIE, oidcCookieAttributes } from "@/lib/auth/cookies";
import { logAuthFailure } from "@/lib/auth/log";
import { safeNextPath } from "@/lib/auth/next-path";
import { createLoginRequest, signOidcContainer } from "@/lib/auth/oidc";
import { redirectResponse } from "@/lib/auth/routes";
import { requireOidcSettings } from "@/lib/auth/settings";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const config = loadConfig();
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  try {
    const login = await createLoginRequest(requireOidcSettings(config), next);
    const containerToken = await signOidcContainer(login.container, config.sessionSecret);

    const response = redirectResponse(config.appUrl, login.url.toString());
    response.cookies.set(OIDC_COOKIE, containerToken, oidcCookieAttributes(config.appUrl));
    return response;
  } catch (error) {
    logAuthFailure("login", error);
    return redirectResponse(config.appUrl, "/login?error=failed");
  }
}
