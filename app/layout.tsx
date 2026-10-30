import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { ThemeProvider } from "@/components/studio/theme-provider";
import { cn } from "@/lib/utils";

import "./globals.css";

// cyrillic в subsets включает предзагрузку кириллических начертаний;
// сами начертания объявляются через unicode-range и без этого.
const geist = Geist({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "42 AI Studio",
  description: "Видео с помощью ИИ: агент-видеограф собирает и рендерит ролик по задаче.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
