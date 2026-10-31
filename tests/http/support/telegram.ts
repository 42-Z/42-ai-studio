/** Управление тестовым издателем OIDC через его HTTP-интерфейс. */
import { loadConfig } from "../../../lib/config";
import type { TamperKind, TelegramProfile } from "./oidc-issuer";

const config = loadConfig();

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  const response = await fetch(new URL(path, config.telegramOidcIssuer), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`тестовый издатель ответил ${response.status} на ${path}`);
  }
  return response;
}

/** Подмены Telegram: по умолчанию профиль фиксированный, порчи нет. */
export const telegramStub = {
  setProfile(profile: TelegramProfile): Promise<void> {
    return post("/__control", { profile }).then(() => undefined);
  },
  tamper(kind: TamperKind | null): Promise<void> {
    return post("/__control", { tamper: kind }).then(() => undefined);
  },
  /** Возвращает издателя в исходное состояние; вызывать в `beforeEach`. */
  reset(): Promise<void> {
    return post("/__control", { reset: true }).then(() => undefined);
  },
  /** Подписанный `id_token` для указанного nonce (как из popup Telegram). */
  async idTokenFor(nonce: string | undefined): Promise<string> {
    const response = await post("/__token", { nonce });
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string") {
      throw new Error("издатель не вернул id_token");
    }
    return body.id_token;
  },
  /** Последний выданный токен — для проверки журнала приложения. */
  async lastIssued(): Promise<{ idToken: string } | null> {
    const response = await fetch(new URL("/__last", config.telegramOidcIssuer));
    if (!response.ok) {
      throw new Error(`тестовый издатель ответил ${response.status} на запрос последней выдачи`);
    }
    return (await response.json()) as { idToken: string } | null;
  },
};
