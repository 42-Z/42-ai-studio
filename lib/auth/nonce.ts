/**
 * Одноразовые nonce входа OIDC: выдача и атомарное погашение в базе.
 * Повторное использование уже погашенного nonce не проходит.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lte } from "drizzle-orm";

import { getDb } from "../db/client";
import { loginNonces } from "../db/schema";

export const NONCE_TTL_SECONDS = 600;

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

/** Создаёт nonce и удаляет просроченные строки. */
export async function issueLoginNonce(): Promise<string> {
  const db = getDb();
  const now = new Date();
  const nonce = randomBytes(32).toString("base64url");

  await db.delete(loginNonces).where(lte(loginNonces.expiresAt, now));
  await db.insert(loginNonces).values({
    nonceHash: hashNonce(nonce),
    createdAt: now,
    expiresAt: new Date(now.getTime() + NONCE_TTL_SECONDS * 1000),
  });
  return nonce;
}

/** Погашает nonce: `true` — строка была и ещё не просрочена. */
export async function consumeLoginNonce(nonce: string): Promise<boolean> {
  const [deleted] = await getDb()
    .delete(loginNonces)
    .where(
      and(
        eq(loginNonces.nonceHash, hashNonce(nonce)),
        gt(loginNonces.expiresAt, new Date()),
      ),
    )
    .returning({ id: loginNonces.id });
  return deleted !== undefined;
}
