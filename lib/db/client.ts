/**
 * Клиент Drizzle к Postgres: один пул на процесс, создаётся лениво.
 * Строка подключения приходит из модуля конфигурации, `process.env` здесь нет.
 *
 * Пул postgres.js по умолчанию (до 10 соединений): `sql.begin` занимает
 * соединение на всё время транзакции, и при одном соединении запрос вне её
 * из колбэка ждал бы бесконечно. В dev клиент живёт на `globalThis`, иначе
 * горячая перезагрузка Next.js плодит новые пулы.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { loadConfig } from "../config";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

interface DbState {
  sql: postgres.Sql;
  database: Database;
}

const globalForDb = globalThis as typeof globalThis & { __studioDb?: DbState };

let state: DbState | undefined = globalForDb.__studioDb;

function ensureState(): DbState {
  if (state === undefined) {
    const sql = postgres(loadConfig().databaseUrl);
    state = { sql, database: drizzle(sql, { schema }) };
    if (process.env.NODE_ENV !== "production") globalForDb.__studioDb = state;
  }
  return state;
}

export function getDb(): Database {
  return ensureState().database;
}

/** Пул процесса (для разовых запросов обвязки). */
export function getSqlClient(): postgres.Sql {
  return ensureState().sql;
}

/** Закрывает пул процесса. */
export async function closeDb(): Promise<void> {
  const current = state;
  state = undefined;
  delete globalForDb.__studioDb;
  if (current !== undefined) await current.sql.end();
}
