/** Сбой шага входа пишется в журнал одним кодом, без секретов и токенов. */
import { AuthFlowError } from "./oidc";

export function logAuthFailure(step: string, error: unknown): void {
  const code = error instanceof AuthFlowError ? error.code : "failed";
  console.error(`[auth] ${step}: ${code}`);
}
