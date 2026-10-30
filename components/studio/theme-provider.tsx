"use client";

import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Тонкая обёртка next-themes с параметрами приложения. Тесты отрисовки
 * подключают её же, чтобы проверять интерфейс в тех же условиях.
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    />
  );
}
