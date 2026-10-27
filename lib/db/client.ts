/**
 * Клиент Drizzle к Postgres: одно подключение на процесс, создаётся лениво.
 * Строка подключения приходит из модуля конфигурации, `process.env` здесь нет.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { loadConfig } from "../config";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let sql: postgres.Sql | undefined;
let database: Database | undefined;

export function getDb(): Database {
  if (database === undefined) {
    sql = postgres(loadConfig().databaseUrl, { max: 1 });
    database = drizzle(sql, { schema });
  }
  return database;
}

/** Открытое подключение процесса (для разовых запросов обвязки). */
export function getSqlClient(): postgres.Sql {
  getDb();
  return sql as postgres.Sql;
}

/** Закрывает подключение процесса. */
export async function closeDb(): Promise<void> {
  const current = sql;
  sql = undefined;
  database = undefined;
  if (current !== undefined) await current.end();
}
