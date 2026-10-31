import { redirect } from "next/navigation";

import type { LoginError } from "@/components/studio/login-card";
import { LoginPanel } from "@/components/studio/login-panel";
import { getCurrentUser } from "@/lib/auth/guard";
import { safeNextPath } from "@/lib/auth/next-path";
import { telegramLoginScriptUrl } from "@/lib/auth/settings";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

function errorFrom(value: string | string[] | undefined): LoginError {
  if (value === "blocked" || value === "failed") return value;
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  const user = await getCurrentUser();
  if (user !== null && !user.isBlocked) redirect(next);

  const config = loadConfig();
  const error: LoginError = user?.isBlocked === true ? "blocked" : errorFrom(params.error);

  return (
    <LoginPanel
      next={next}
      clientId={config.telegramClientId ?? null}
      scriptUrl={telegramLoginScriptUrl(config)}
      devLoginEnabled={config.devLoginEnabled}
      error={error}
    />
  );
}
