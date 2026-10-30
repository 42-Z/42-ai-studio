"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/studio/app-shell";
import { navItems } from "@/components/studio/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AppShell navItems={navItems} pathname={pathname}>
      {children}
    </AppShell>
  );
}
