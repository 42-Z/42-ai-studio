/**
 * POST /api/auth/logout — удаляет строку `auth_sessions` и cookie.
 * Чужой `Origin` — 403, и тогда сессия остаётся.
 */
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, sessionCookieAttributes } from "@/lib/auth/cookies";
import { checkOrigin } from "@/lib/auth/guard";
import { readCookie } from "@/lib/auth/request";
import { deleteUserSession } from "@/lib/auth/service";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const config = loadConfig();

  const originError = checkOrigin(request, config.appUrl);
  if (originError !== null) return originError;

  const token = readCookie(request, SESSION_COOKIE);
  if (token !== null) await deleteUserSession(token);

  const response = new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieAttributes(config.appUrl, config.sessionTtlDays),
    maxAge: 0,
  });
  return response;
}
