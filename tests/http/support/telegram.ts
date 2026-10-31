/** Управление тестовым издателем OIDC через его HTTP-интерфейс. */
import { loadConfig } from "../../../lib/config";
import type { TamperKind, TelegramProfile } from "./oidc-issuer";

const config = loadConfig();

async function control(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(new URL("/__control", config.telegramOidcIssuer), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`тестовый издатель ответил ${response.status} на управляющий запрос`);
  }
}

/** Подмены Telegram: по умолчанию всё одобряется, профиль фиксированный. */
export const telegramStub = {
  setProfile(profile: TelegramProfile): Promise<void> {
    return control({ profile });
  },
  tamper(kind: TamperKind | null): Promise<void> {
    return control({ tamper: kind });
  },
  authorize(mode: "approve" | "deny"): Promise<void> {
    return control({ authorize: mode });
  },
  /** Возвращает издателя в исходное состояние; вызывать в `beforeEach`. */
  reset(): Promise<void> {
    return control({ reset: true });
  },
  /** Последняя выданная пара `code`/`id_token` — для проверки журнала. */
  async lastIssued(): Promise<{ code: string; idToken: string } | null> {
    const response = await fetch(new URL("/__last", config.telegramOidcIssuer));
    if (!response.ok) {
      throw new Error(`тестовый издатель ответил ${response.status} на запрос последней выдачи`);
    }
    return (await response.json()) as { code: string; idToken: string } | null;
  },
};
