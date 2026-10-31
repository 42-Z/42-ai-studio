import { CodeIcon, SendIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type LoginError = "blocked" | "failed" | null;

export interface LoginCardProps {
  next: string;
  telegramEnabled: boolean;
  devLoginEnabled: boolean;
  error: LoginError;
}

/**
 * Содержимое страницы входа. Отдельный компонент без серверных зависимостей:
 * его отрисовывают тесты без маршрутизатора.
 */
export function LoginCard({
  next,
  telegramEnabled,
  devLoginEnabled,
  error,
}: LoginCardProps) {
  const nothingConfigured = !telegramEnabled && !devLoginEnabled;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Вход</CardTitle>
        <CardDescription>Войдите через Telegram, отдельный аккаунт не нужен</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error === "blocked" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Доступ закрыт</AlertTitle>
            <AlertDescription>
              Доступ к сервису закрыт для этого аккаунта. Если это ошибка, напишите владельцу
              сервиса.
            </AlertDescription>
          </Alert>
        ) : null}

        {error === "failed" ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Не удалось войти</AlertTitle>
            <AlertDescription>
              Не удалось войти через Telegram. Вход мог быть отменён или устареть, попробуйте ещё
              раз.
            </AlertDescription>
          </Alert>
        ) : null}

        {nothingConfigured ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Вход не настроен</AlertTitle>
            <AlertDescription>
              Владельцу сервиса нужно настроить вход через Telegram.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          {telegramEnabled ? (
            <a
              href={`/api/auth/telegram/login?next=${encodeURIComponent(next)}`}
              className={buttonVariants({ size: "lg", className: "w-full" })}
            >
              <SendIcon data-icon="inline-start" />
              Войти через Telegram
            </a>
          ) : null}

          {devLoginEnabled ? (
            <a
              href={`/api/auth/dev-login?telegramId=1&name=${encodeURIComponent("Разработчик")}`}
              className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}
            >
              <CodeIcon data-icon="inline-start" />
              Войти как разработчик
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
