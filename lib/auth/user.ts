/** Представление пользователя для интерфейса: без служебных полей базы. */
import type { User } from "../db/schema";

export interface PublicUser {
  id: string;
  name: string;
  username: string | null;
  photoUrl: string | null;
  isOperator: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    photoUrl: user.photoUrl,
    isOperator: user.isOperator,
  };
}
