/** Имя пользователя: одна длина и одна обрезка на весь вход. */
export const MAX_NAME_LENGTH = 200;

/**
 * Обрезает имя до 200 символов, считая символы Unicode, а не единицы UTF-16:
 * иначе эмодзи на границе превратилось бы в битый символ.
 */
export function truncateName(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_NAME_LENGTH).join("");
}
