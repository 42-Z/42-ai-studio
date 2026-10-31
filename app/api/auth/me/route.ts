/** GET /api/auth/me — профиль вошедшего пользователя. */
import type { NextRequest } from "next/server";

import { requireApiUser } from "@/lib/auth/guard";
import { toPublicUser } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireApiUser(request);
  if (user instanceof Response) return user;

  return Response.json(toPublicUser(user), {
    headers: { "Cache-Control": "no-store" },
  });
}
