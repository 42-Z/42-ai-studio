import { SessionsEmptyState } from "@/components/studio/sessions-empty-state";
import { requireUser } from "@/lib/auth/guard";

export default async function SessionsPage() {
  await requireUser("/s");

  return <SessionsEmptyState />;
}
