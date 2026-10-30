import { MessagesSquareIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// Временное пустое состояние: содержимое добавят #5 и #6.
export default function SessionsPage() {
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
