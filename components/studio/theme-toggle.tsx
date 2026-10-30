"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themes = [
  { value: "light", title: "Светлая", icon: SunIcon },
  { value: "dark", title: "Тёмная", icon: MoonIcon },
  { value: "system", title: "Системная", icon: MonitorIcon },
];

/** Переключатель светлой, тёмной и системной темы. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // До монтирования тема неизвестна: на сервере нет localStorage.
  // Одинаковая иконка на сервере и при первом рендере в браузере
  // не даёт расхождения гидратации.
  useEffect(() => setMounted(true), []);

  const current = mounted ? themes.find((item) => item.value === theme) : undefined;
  const Icon = current?.icon ?? MonitorIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" aria-label="Тема" />}
      >
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Тема</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            {themes.map((item) => (
              <DropdownMenuRadioItem key={item.value} value={item.value} closeOnClick>
                <item.icon />
                {item.title}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
