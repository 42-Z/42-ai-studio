import { AppFrame } from "@/components/studio/app-frame";
import { getCurrentUser } from "@/lib/auth/guard";
import { toPublicUser } from "@/lib/auth/user";

/**
 * Оболочка группы: показывает пользователя, если он есть. Саму проверку
 * входа делает страница своим путём: layout не знает pathname, а Next.js
 * не перерисовывает его при навигации, поэтому проверка живёт у данных.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <AppFrame user={user === null ? null : toPublicUser(user)}>{children}</AppFrame>
  );
}
