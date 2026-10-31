/** Параметры Telegram из общего модуля конфигурации. */
import type { AppConfig } from "../config";
import { AuthFlowError, type OidcSettings } from "./oidc";

/** Настройки проверки `id_token` или `null`, если Telegram не настроен. */
export function oidcSettings(config: AppConfig): OidcSettings | null {
  if (config.telegramClientId === undefined) return null;
  return {
    issuer: config.telegramOidcIssuer,
    clientId: config.telegramClientId,
  };
}

/** Настройки для маршрута, которому Telegram нужен обязательно. */
export function requireOidcSettings(config: AppConfig): OidcSettings {
  const settings = oidcSettings(config);
  if (settings === null) throw new AuthFlowError("telegram_not_configured");
  return settings;
}

/** Адрес официальной библиотеки входа у того же издателя, что и JWKS. */
export function telegramLoginScriptUrl(config: AppConfig): string {
  return new URL("/js/telegram-login.js?6", config.telegramOidcIssuer).toString();
}
