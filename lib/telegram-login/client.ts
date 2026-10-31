/** Клиентская часть входа: загрузка библиотеки Telegram и разбор ответа. */

export interface TelegramLoginResult {
  id_token?: string;
  error?: string;
}

interface TelegramLoginApi {
  auth(
    options: {
      client_id: string | number;
      scope?: string[];
      nonce?: string;
      lang?: string;
    },
    callback: (result: TelegramLoginResult) => void,
  ): void;
}

declare global {
  interface Window {
    Telegram?: {
      Login?: TelegramLoginApi;
    };
  }
}

let scriptUrl: string | null = null;
let scriptPromise: Promise<void> | null = null;
const SCRIPT_TIMEOUT_MS = 15_000;

/** Загружает библиотеку один раз на страницу. */
export function loadTelegramLogin(url: string): Promise<void> {
  if (typeof window.Telegram?.Login?.auth === "function") return Promise.resolve();
  if (scriptPromise !== null && scriptUrl === url) return scriptPromise;

  scriptUrl = url;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      scriptPromise = null;
      scriptUrl = null;
      script.remove();
      reject(new Error("telegram login script failed to load"));
    };
    const timeout = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (typeof window.Telegram?.Login?.auth !== "function") {
        fail();
        return;
      }
      window.clearTimeout(timeout);
      resolve();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type Navigate = (url: string) => void;

/**
 * Разбирает ответ библиотеки и отправляет `id_token` с nonce на сервер.
 * Навигация вынесена в зависимость: так её можно проверить без браузера.
 */
export async function finishTelegramLogin(
  result: TelegramLoginResult,
  options: {
    next: string;
    nonceToken: string;
    navigate: Navigate;
    fetcher?: typeof fetch;
  },
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const failedUrl = loginErrorUrl(options.next, "failed");

  if (result.error !== undefined || typeof result.id_token !== "string" || result.id_token.length === 0) {
    options.navigate(failedUrl);
    return;
  }

  try {
    const response = await fetcher("/api/auth/telegram/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: result.id_token, nonceToken: options.nonceToken }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      options.navigate(options.next);
      return;
    }

    if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string } }
        | null;
      options.navigate(
        body?.error?.code === "user_blocked" ? loginErrorUrl(options.next, "blocked") : failedUrl,
      );
      return;
    }
    options.navigate(failedUrl);
  } catch {
    options.navigate(failedUrl);
  }
}

export function loginErrorUrl(next: string, error: "blocked" | "failed"): string {
  return `/login?next=${encodeURIComponent(next)}&error=${error}`;
}
