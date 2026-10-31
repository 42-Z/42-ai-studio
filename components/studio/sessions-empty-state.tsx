import { MessagesSquareIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** Пустое состояние списка сессий: содержимое добавят #5 и #6. */
export function SessionsEmptyState() {
  return (
    <Empty className="flex-1 border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquareIcon />
        </EmptyMedia>
        <EmptyTitle>Сессий пока нет</EmptyTitle>
        <EmptyDescription>
          Первая сессия появится здесь, как только вы её создадите.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
