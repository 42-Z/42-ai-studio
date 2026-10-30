import type { ReactNode } from "react";

import { Brand } from "@/components/studio/brand";
import { ThemeToggle } from "@/components/studio/theme-toggle";

export interface PublicShellProps {
  children: ReactNode;
}

/** Каркас публичных страниц: шапка с названием сервиса и переключателем темы. */
export function PublicShell({ children }: PublicShellProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="flex h-14 w-full items-center justify-between gap-4 px-4">
          <Brand />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex w-full flex-1 flex-col items-center justify-center px-4 py-12">
        {children}
      </main>
    </div>
  );
}
