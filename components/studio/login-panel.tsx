"use client";

import { useEffect, useRef, useState } from "react";

import { LoginCard, type LoginError } from "@/components/studio/login-card";
import { finishTelegramLogin, loadTelegramLogin, loginErrorUrl } from "@/lib/telegram-login/client";

export interface LoginPanelProps {
  next: string;
  /** Client ID из @BotFather; `null` — Telegram не настроен. */
  clientId: string | null;
  /** Адрес библиотеки у издателя. */
  scriptUrl: string;
  devLoginEnabled: boolean;
  error: LoginError;
  /** Переход после ответа; в тестах подменяется. */
  navigate?: (url: string) => void;
}

interface LoginNonce {
  nonce: string;
  token: string;
  preparedAt: number;
}

/** nonce обновляется заранее, чтобы кнопка не устаревала за 10 минут. */
const NONCE_REFRESH_MS = 5 * 60 * 1000;
/** Если popup заблокирован, библиотека не вызовет callback — снимаем блокировку. */
const POPUP_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Страница входа с popup-библиотекой Telegram: получает одноразовый `nonce`
 * у сервера, открывает окно Telegram и отправляет `id_token` на проверку.
 */
export function LoginPanel({
  next,
  clientId,
  scriptUrl,
  devLoginEnabled,
  error,
  navigate = (url) => window.location.assign(url),
}: LoginPanelProps) {
  const [login, setLogin] = useState<LoginNonce | null>(null);
  const [scriptState, setScriptState] = useState<"loading" | "ready" | "failed">("loading");
  const [nonceFailed, setNonceFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [popupFailed, setPopupFailed] = useState(false);
  const popupTimeout = useRef<number | null>(null);
  const popupSequence = useRef(0);
  const failed = scriptState === "failed" || nonceFailed || popupFailed;

  useEffect(() => {
    if (clientId === null) return;
    let active = true;

    loadTelegramLogin(scriptUrl)
      .then(() => {
        if (active) {
          setScriptState("ready");
        }
      })
      .catch(() => {
        if (active) setScriptState("failed");
      });

    return () => {
      active = false;
    };
  }, [clientId, scriptUrl]);

  useEffect(() => {
    if (clientId === null) return;
    let active = true;
    let inFlight = false;
    let controller: AbortController | undefined;

    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch("/api/auth/telegram/nonce", {
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (active) setNonceFailed(true);
          return;
        }
        const body = (await response.json()) as { nonce?: unknown; token?: unknown };
        if (typeof body.nonce !== "string" || typeof body.token !== "string") {
          if (active) setNonceFailed(true);
          return;
        }
        if (active) {
          setLogin({ nonce: body.nonce, token: body.token, preparedAt: Date.now() });
          setNonceFailed(false);
        }
      } catch {
        if (active) setNonceFailed(true);
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), NONCE_REFRESH_MS);

    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [clientId]);

  useEffect(
    () => () => {
      if (popupTimeout.current !== null) window.clearTimeout(popupTimeout.current);
      popupSequence.current += 1;
    },
    [],
  );

  const openTelegram = () => {
    if (failed) {
      navigate(loginErrorUrl(next, "failed"));
      return;
    }

    const telegram = window.Telegram?.Login;
    if (telegram === undefined) {
      setScriptState("failed");
      return;
    }
    if (clientId === null || login === null || popupTimeout.current !== null) return;
    if (Date.now() - login.preparedAt >= NONCE_REFRESH_MS) {
      navigate(loginErrorUrl(next, "failed"));
      return;
    }

    setBusy(true);
    const sequence = ++popupSequence.current;
    const failPopup = () => {
      popupSequence.current += 1;
      if (popupTimeout.current !== null) window.clearTimeout(popupTimeout.current);
      popupTimeout.current = null;
      setBusy(false);
      setPopupFailed(true);
    };
    popupTimeout.current = window.setTimeout(failPopup, POPUP_TIMEOUT_MS);
    try {
      telegram.auth({ client_id: clientId, scope: ["profile"], nonce: login.nonce }, (result) => {
        if (popupSequence.current !== sequence) return;
        popupSequence.current += 1;
        if (popupTimeout.current !== null) window.clearTimeout(popupTimeout.current);
        popupTimeout.current = null;
        void finishTelegramLogin(result, {
          next,
          nonceToken: login.token,
          navigate,
        }).finally(() => setBusy(false));
      });
    } catch {
      failPopup();
    }
  };

  return (
    <LoginCard
      telegramEnabled={clientId !== null}
      devLoginEnabled={devLoginEnabled}
      error={error ?? (failed ? "failed" : null)}
      onTelegramClick={openTelegram}
      telegramBusy={busy || (!failed && (scriptState !== "ready" || login === null))}
    />
  );
}
