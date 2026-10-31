/**
 * POST /api/auth/telegram/callback — браузер приносит `id_token` из popup
 * и подписанный nonce. Сервер проверяет подпись, claims и гасит nonce,
 * создаёт сессию и отдаёт `{ok:true}`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionCookieAttributes } from "@/lib/auth/cookies";
import { checkOrigin } from "@/lib/auth/guard";
import { logAuthFailure } from "@/lib/auth/log";
import { consumeLoginNonce } from "@/lib/auth/nonce";
import {
  AuthFlowError,
  authenticateWithIdToken,
  verifyLoginNonce,
} from "@/lib/auth/oidc";
import { requireOidcSettings } from "@/lib/auth/settings";
import { createUserSession, upsertTelegramUser } from "@/lib/auth/service";
import { loadConfig } from "@/lib/config";
import { errorResponse } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const config = loadConfig();

  const originError = checkOrigin(request, config.appUrl);
  if (originError !== null) return originError;

  try {
    const body = (await request.json()) as { idToken?: unknown; nonceToken?: unknown };
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const nonceToken = typeof body.nonceToken === "string" ? body.nonceToken : "";
    if (idToken.length === 0) throw new AuthFlowError("no_id_token");
    if (nonceToken.length === 0) throw new AuthFlowError("no_nonce");

    const nonce = await verifyLoginNonce(nonceToken, config.sessionSecret);
    const profile = await authenticateWithIdToken(requireOidcSettings(config), {
      idToken,
      expectedNonce: nonce,
    });

    // Nonce одноразовый: погашение атомарно, повторная пара не пройдёт.
    if (!(await consumeLoginNonce(nonce))) throw new AuthFlowError("bad_nonce");

    const result = await upsertTelegramUser(profile);
    if (result.blocked) {
      logAuthFailure("callback", new AuthFlowError("user_blocked"));
      return errorResponse(403, "user_blocked", "Доступ закрыт");
    }

    const sessionToken = await createUserSession(result.user.id, config.sessionTtlDays);

    const response = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      SESSION_COOKIE,
      sessionToken,
      sessionCookieAttributes(config.appUrl, config.sessionTtlDays),
    );
    return response;
  } catch (error) {
    logAuthFailure("callback", error);
    return errorResponse(401, "failed", "Не удалось войти");
  }
}
