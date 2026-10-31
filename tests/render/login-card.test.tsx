import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import { LoginCard } from "@/components/studio/login-card";
import { PublicShell } from "@/components/studio/public-shell";

import { expectNoHorizontalScroll, renderOnDesktop, renderOnPhone } from "./support/render";

function loginCard(props: {
  telegramEnabled: boolean;
  devLoginEnabled: boolean;
  error: "blocked" | "failed" | null;
  onTelegramClick?: () => void;
}) {
  return (
    <PublicShell>
      <LoginCard {...props} />
    </PublicShell>
  );
}

test("страница входа показывает заголовок и кнопку Telegram", async () => {
  await renderOnDesktop(
    loginCard({ telegramEnabled: true, devLoginEnabled: false, error: null }),
  );

  await expect.element(page.getByText("Вход", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Войдите через Telegram, отдельный аккаунт не нужен"))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Войти через Telegram" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Войти как разработчик" }))
    .not.toBeInTheDocument();
});

test("кнопка Telegram вызывает обработчик", async () => {
  const onTelegramClick = vi.fn();
  await renderOnDesktop(
    loginCard({
      telegramEnabled: true,
      devLoginEnabled: false,
      error: null,
      onTelegramClick,
    }),
  );

  await page.getByRole("button", { name: "Войти через Telegram" }).click();

  expect(onTelegramClick).toHaveBeenCalledTimes(1);
});

test("кнопка разработчика видна только при включённом флаге", async () => {
  await renderOnDesktop(
    loginCard({ telegramEnabled: false, devLoginEnabled: true, error: null }),
  );

  await expect
    .element(page.getByRole("button", { name: "Войти как разработчик" }))
    .toHaveAttribute("href", expect.stringContaining("/api/auth/dev-login"));
});

test("сообщение о закрытом доступе", async () => {
  await renderOnDesktop(
    loginCard({ telegramEnabled: true, devLoginEnabled: false, error: "blocked" }),
  );
  await expect
    .element(
      page.getByText(
        "Доступ к сервису закрыт для этого аккаунта. Если это ошибка, напишите владельцу сервиса.",
      ),
    )
    .toBeVisible();
});

test("сообщение о неудачном входе", async () => {
  await renderOnDesktop(
    loginCard({ telegramEnabled: true, devLoginEnabled: false, error: "failed" }),
  );
  await expect
    .element(
      page.getByText(
        "Не удалось войти через Telegram. Вход мог быть отменён или устареть, попробуйте ещё раз.",
      ),
    )
    .toBeVisible();
});

test("сообщение о закрытом доступе на телефоне", async () => {
  await renderOnPhone(
    loginCard({ telegramEnabled: true, devLoginEnabled: false, error: "blocked" }),
  );

  await expect
    .element(page.getByText(/Доступ к сервису закрыт для этого аккаунта/))
    .toBeVisible();
  expectNoHorizontalScroll();
});

test("сообщение о неудачном входе на телефоне", async () => {
  await renderOnPhone(
    loginCard({ telegramEnabled: true, devLoginEnabled: false, error: "failed" }),
  );

  await expect
    .element(page.getByText(/Не удалось войти через Telegram/))
    .toBeVisible();
  expectNoHorizontalScroll();
});

test("без настроенного входа показывает предупреждение", async () => {
  await renderOnDesktop(
    loginCard({ telegramEnabled: false, devLoginEnabled: false, error: null }),
  );

  await expect.element(page.getByText("Вход не настроен")).toBeVisible();
});

test("страница входа не прокручивается по горизонтали на телефоне", async () => {
  await renderOnPhone(
    loginCard({ telegramEnabled: true, devLoginEnabled: true, error: null }),
  );

  await expect.element(page.getByText("Вход", { exact: true })).toBeVisible();
  expectNoHorizontalScroll();
});

test("страница входа не прокручивается по горизонтали на компьютере", async () => {
  await renderOnDesktop(
    loginCard({ telegramEnabled: true, devLoginEnabled: true, error: null }),
  );

  await expect.element(page.getByText("Вход", { exact: true })).toBeVisible();
  expectNoHorizontalScroll();
});
