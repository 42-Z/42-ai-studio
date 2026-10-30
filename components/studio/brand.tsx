import { ClapperboardIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Логотип и название сервиса. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ClapperboardIcon />
      </span>
      <span className="truncate font-heading text-sm font-medium">42 AI Studio</span>
    </span>
  );
}
