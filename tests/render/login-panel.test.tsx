import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { LoginPanel } from "@/components/studio/login-panel";

import { renderOnDesktop } from "./support/render";

const TEST_SCRIPT_URL = "/missing-telegram-login.js";

afterEach(() => {
  window.Telegram = undefined;
  vi.unstubAllGlobals();
});

test("nonce берётся до клика, ответ popup уходит на сервер", async () => {
  const auth = vi.fn(
    (_options: unknown, callback: (result: { id_token: string }) => void) => {
      callback({ id_token: "полученный-токен" });
    },
  );
  window.Telegram = { Login: { auth } };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/telegram/nonce") {
      return new Response(JSON.stringify({ nonce: "n-123", token: "t-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const navigate = vi.fn();

  await renderOnDesktop(
    <LoginPanel
      next="/s/session-1"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={navigate}
    />,
  );

  const button = page.getByRole("button", { name: "Войти через Telegram" });
  await vi.waitFor(() => {
    expect((button.element() as HTMLButtonElement).disabled).toBe(false);
  });

  await button.click();

  await vi.waitFor(() => {
    expect(navigate).toHaveBeenCalledWith("/s/session-1");
  });
  expect(auth).toHaveBeenCalledWith(
    { client_id: "424242", scope: ["profile"], nonce: "n-123" },
    expect.any(Function),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/telegram/callback",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ idToken: "полученный-токен", nonceToken: "t-123" }),
    }),
  );
});

test("сбой скрипта остаётся видимым после успешного получения nonce", async () => {
  let resolveNonce!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
    resolveNonce = resolve;
  })));
  const navigate = vi.fn();

  await renderOnDesktop(
    <LoginPanel
      next="/s/session-1"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={navigate}
    />,
  );

  await expect.element(page.getByRole("alert")).toBeVisible();
  resolveNonce(Response.json({ nonce: "n-123", token: "t-123" }));
  await expect.element(page.getByRole("alert")).toBeVisible();

  const button = page.getByRole("button", { name: "Войти через Telegram" });
  await expect.element(button).toBeEnabled();
  await button.click();
  expect(navigate).toHaveBeenCalledWith("/login?next=%2Fs%2Fsession-1&error=failed");
});

test("сбой получения nonce не оставляет кнопку недоступной", async () => {
  window.Telegram = { Login: { auth: vi.fn() } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

  await renderOnDesktop(
    <LoginPanel
      next="/s"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={vi.fn()}
    />,
  );

  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Войти через Telegram" })).toBeEnabled();
});

test("синхронная ошибка библиотеки не оставляет вход заблокированным", async () => {
  window.Telegram = { Login: { auth: vi.fn(() => { throw new Error("popup failed"); }) } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ nonce: "n-123", token: "t-123" })));

  await renderOnDesktop(
    <LoginPanel
      next="/s"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={vi.fn()}
    />,
  );

  const button = page.getByRole("button", { name: "Войти через Telegram" });
  await expect.element(button).toBeEnabled();
  await button.click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(button).toBeEnabled();
});

test.each([
  { status: 403, code: "user_blocked", error: "blocked" },
  { status: 403, code: "forbidden", error: "failed" },
  { status: 401, code: "failed", error: "failed" },
  { status: 500, code: "internal_error", error: "failed" },
])("callback $status/$code сохраняет next и показывает $error", async ({ status, code, error }) => {
  window.Telegram = { Login: { auth: (_options, callback) => callback({ id_token: "token" }) } };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    return String(input) === "/api/auth/telegram/nonce"
      ? Response.json({ nonce: "n-123", token: "t-123" })
      : Response.json({ error: { code } }, { status });
  }));
  const navigate = vi.fn();

  await renderOnDesktop(
    <LoginPanel
      next="/s/session-1"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={navigate}
    />,
  );

  const button = page.getByRole("button", { name: "Войти через Telegram" });
  await expect.element(button).toBeEnabled();
  await button.click();
  await vi.waitFor(() => {
    expect(navigate).toHaveBeenCalledWith(`/login?next=%2Fs%2Fsession-1&error=${error}`);
  });
});

test("закрытие popup не отправляет запрос с id_token", async () => {
  window.Telegram = { Login: { auth: (_options, callback) => callback({ error: "popup_closed" }) } };
  const fetchMock = vi.fn(async () => Response.json({ nonce: "n-123", token: "t-123" }));
  vi.stubGlobal("fetch", fetchMock);
  const navigate = vi.fn();

  await renderOnDesktop(
    <LoginPanel
      next="/s/session-1"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={navigate}
    />,
  );

  const button = page.getByRole("button", { name: "Войти через Telegram" });
  await expect.element(button).toBeEnabled();
  await button.click();
  expect(navigate).toHaveBeenCalledWith("/login?next=%2Fs%2Fsession-1&error=failed");
  expect(fetchMock).not.toHaveBeenCalledWith("/api/auth/telegram/callback", expect.anything());
});

test("сбой сети при callback сохраняет путь возврата", async () => {
  window.Telegram = { Login: { auth: (_options, callback) => callback({ id_token: "token" }) } };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/telegram/nonce") {
      return Response.json({ nonce: "n-123", token: "t-123" });
    }
    throw new Error("offline");
  }));
  const navigate = vi.fn();

  await renderOnDesktop(
    <LoginPanel
      next="/s/session-1"
      clientId="424242"
      scriptUrl={TEST_SCRIPT_URL}
      devLoginEnabled={false}
      error={null}
      navigate={navigate}
    />,
  );

  const button = page.getByRole("button", { name: "Войти через Telegram" });
  await expect.element(button).toBeEnabled();
  await button.click();
  await vi.waitFor(() => {
    expect(navigate).toHaveBeenCalledWith("/login?next=%2Fs%2Fsession-1&error=failed");
  });
});
