import { cn } from "@/lib/utils";

/**
 * Название сервиса. Логотипа пока нет, поэтому иконки-заглушки нет:
 * бренд остаётся текстовым, пока не появится настоящий знак.
 */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("block min-w-0 truncate font-heading text-sm font-medium", className)}>
      42 AI Studio
    </span>
  );
}
