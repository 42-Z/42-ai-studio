import { MessagesSquareIcon, type LucideIcon } from "lucide-react";

/** Пункт боковой навигации приложения. */
export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Показывает пункт только оператору. Проверку добавит #30. */
  requires?: "operator";
}

/**
 * Единственный список пунктов навигации на весь проект.
 * «Настройки» добавит #26, «Админку» (`requires: "operator"`) — #30.
 */
export const navItems: NavItem[] = [
  {
    title: "Сессии",
    href: "/s",
    icon: MessagesSquareIcon,
  },
];
