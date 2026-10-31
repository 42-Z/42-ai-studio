/** Параметры Telegram из общего модуля конфигурации. */
import type { AppConfig } from "../config";
import { AuthFlowError, type OidcSettings } from "./oidc";

/** Настройки входа OIDC или `null`, если Telegram не настроен. */
export function oidcSettings(config: AppConfig): OidcSettings | null {
  if (config.telegramClientId === undefined || config.telegramClientSecret === undefined) return null;
  return {
    issuer: config.telegramOidcIssuer,
    clientId: config.telegramClientId,
    clientSecret: config.telegramClientSecret,
    appUrl: config.appUrl,
  };
}

/** Настройки для маршрута, которому Telegram нужен обязательно. */
export function requireOidcSettings(config: AppConfig): OidcSettings {
  const settings = oidcSettings(config);
  if (settings === null) throw new AuthFlowError("telegram_not_configured");
  return settings;
}
