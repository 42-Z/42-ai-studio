/** Начало входа: PKCE, state, nonce, HttpOnly-cookie и редирект в Telegram. */
import type { NextRequest } from "next/server";

import { OIDC_COOKIE, oidcCookieAttributes } from "@/lib/auth/cookies";
import { checkOrigin } from "@/lib/auth/guard";
import { logAuthFailure } from "@/lib/auth/log";
import { safeNextPath } from "@/lib/auth/next-path";
import { createLoginRequest, signOidcContainer } from "@/lib/auth/oidc";
import { redirectResponse } from "@/lib/auth/routes";
import { requireOidcSettings } from "@/lib/auth/settings";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const config = loadConfig();
  const originError = checkOrigin(request, config.appUrl);
  if (originError !== null) return originError;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  try {
    const login = await createLoginRequest(requireOidcSettings(config), next);
    const token = await signOidcContainer(login.container, config.sessionSecret);
    const response = redirectResponse(config.appUrl, login.url.toString());
    response.cookies.set(OIDC_COOKIE, token, oidcCookieAttributes(config.appUrl));
    return response;
  } catch (error) {
    logAuthFailure("login", error);
    return redirectResponse(config.appUrl, "/login?error=failed");
  }
}
