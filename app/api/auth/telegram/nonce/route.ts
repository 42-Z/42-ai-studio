/**
 * POST /api/auth/telegram/nonce — начало popup-входа: одноразовый nonce,
 * подписанный токен для callback. Cookie не нужна: токен хранится в памяти
 * вкладки, поэтому две вкладки не перетирают друг друга.
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkOrigin } from "@/lib/auth/guard";
import { logAuthFailure } from "@/lib/auth/log";
import { issueLoginNonce } from "@/lib/auth/nonce";
import { signLoginNonce } from "@/lib/auth/oidc";
import { oidcSettings } from "@/lib/auth/settings";
import { loadConfig } from "@/lib/config";
import { errorResponse } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const config = loadConfig();

  const originError = checkOrigin(request, config.appUrl);
  if (originError !== null) return originError;

  if (oidcSettings(config) === null) {
    return errorResponse(404, "not_found", "Страница не найдена");
  }

  try {
    const nonce = await issueLoginNonce();
    const token = await signLoginNonce(nonce, config.sessionSecret);

    return NextResponse.json(
      { nonce, token },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logAuthFailure("nonce", error);
    return errorResponse(500, "internal_error", "Не удалось начать вход");
  }
}
