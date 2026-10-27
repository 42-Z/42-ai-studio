/**
 * Серверный модуль конфигурации: единственное место, где читаются переменные
 * окружения проекта. Остальной код `process.env` напрямую не читает (исключение —
 * переменные самого фреймворка: `NODE_ENV`, `PORT`, `EVE_*`).
 *
 * Файлы `.env*` читаются через `loadEnvConfig` из `@next/env` — тем же механизмом,
 * что и Next.js. Переменные, заданные в самом процессе, главнее файлов.
 *
 * Правило для следующих тикетов: любая новая переменная появляется здесь, в
 * `.env.example` и, если без неё сервер перестанет стартовать в тестах, в `.env.test`.
 */
import { loadEnvConfig } from "@next/env";
import { z } from "zod";

/** Ошибка конфигурации: каждая строка списка — «ИМЯ: причина». */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Некорректная конфигурация окружения:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Типизированный объект конфигурации. */
export interface AppConfig {
  /** Строка подключения к Postgres. */
  readonly databaseUrl: string;
  /** URL S3-совместимого API. */
  readonly s3Endpoint: string;
  /** Регион хранилища (для MinIO подойдёт любой). */
  readonly s3Region: string;
  /** Имя бакета. */
  readonly s3Bucket: string;
  /** Ключ доступа к хранилищу. */
  readonly s3AccessKeyId: string;
  /** Секретный ключ хранилища. */
  readonly s3SecretAccessKey: string;
  /** Адресация «хост/бакет/ключ» (так требует MinIO). */
  readonly s3ForcePathStyle: boolean;
  /** Публичный адрес приложения без завершающего «/». */
  readonly appUrl: string;
  /** Тестовые подмены (появятся в следующих тикетах). */
  readonly appTestMode: boolean;
  /** Порт основного экземпляра приложения в HTTP-тестах. */
  readonly testAppPort: number;
  /** Каталог сборки Next.js. */
  readonly nextDistDir: string;
}

/**
 * Один помощник для логических значений: `1`, `0`, `true`, `false`.
 * `z.coerce.boolean()` не годится — строка `«false»` стала бы `true`.
 */
const envBoolean = z
  .string({ error: "ожидается одно из значений: 1, 0, true, false" })
  .transform((value, ctx) => {
    switch (value.trim().toLowerCase()) {
      case "1":
      case "true":
        return true;
      case "0":
      case "false":
        return false;
      default:
        ctx.addIssue({
          code: "custom",
          message: "ожидается одно из значений: 1, 0, true, false",
        });
        return z.NEVER;
    }
  });

const envString = z
  .string({ error: "обязательная переменная не задана" })
  .min(1, "обязательная переменная не задана");

/** Форма проверяется как URL; доступность сервиса видит `/api/health`. */
const envUrl = envString.refine((value) => {
  try {
    // Абсолютный URL с хостом: иначе и «localhost:59000» выглядит как URL
    // (схема localhost, непрозрачный путь).
    return new URL(value).host !== "";
  } catch {
    return false;
  }
}, "ожидается корректный URL");

const envSchema = z.object({
  DATABASE_URL: envUrl,
  S3_ENDPOINT: envUrl,
  S3_REGION: envString,
  S3_BUCKET: envString,
  S3_ACCESS_KEY_ID: envString,
  S3_SECRET_ACCESS_KEY: envString,
  S3_FORCE_PATH_STYLE: envBoolean.optional().default(false),
  APP_URL: envUrl.refine(
    (value) => !value.endsWith("/"),
    "не должен заканчиваться на /",
  ),
  APP_TEST_MODE: envBoolean.optional().default(false),
  TEST_APP_PORT: z.coerce
    .number({ error: "ожидается целое число от 1 до 65535" })
    .int("ожидается целое число от 1 до 65535")
    .min(1, "ожидается целое число от 1 до 65535")
    .max(65535, "ожидается целое число от 1 до 65535")
    .optional()
    .default(3100),
  NEXT_DIST_DIR: z
    .string({ error: "не может быть пустой" })
    .min(1, "не может быть пустой")
    .optional()
    .default(".next"),
});

/** Запись окружения: как `process.env`. */
export type EnvRecord = Record<string, string | undefined>;

function formatIssues(error: z.ZodError): string[] {
  const byName = new Map<string, string>();
  for (const issue of error.issues) {
    const name = issue.path.join(".") || "конфигурация";
    if (!byName.has(name)) byName.set(name, issue.message);
  }
  return [...byName].map(([name, message]) => `${name}: ${message}`);
}

/**
 * Чистая проверка: принимает запись окружения, отдаёт типизированный объект
 * или бросает `ConfigError` с именами переменных и причинами. Файлы не читает.
 */
export function parseConfig(env: EnvRecord): AppConfig {
  // Пустая строка — как отсутствующая переменная.
  const normalized: EnvRecord = {};
  for (const [name, value] of Object.entries(env)) {
    normalized[name] = value === undefined || value.trim() === "" ? undefined : value;
  }

  const result = envSchema.safeParse(normalized);
  const issues: string[] = result.success ? [] : formatIssues(result.error);

  if (result.success && result.data.APP_TEST_MODE && normalized.NODE_ENV === "production") {
    issues.push("APP_TEST_MODE: тестовые подмены запрещены при NODE_ENV=production");
  }

  if (issues.length > 0) throw new ConfigError(issues);

  const data = (result as z.ZodSafeParseSuccess<z.infer<typeof envSchema>>).data;
  return {
    databaseUrl: data.DATABASE_URL,
    s3Endpoint: data.S3_ENDPOINT,
    s3Region: data.S3_REGION,
    s3Bucket: data.S3_BUCKET,
    s3AccessKeyId: data.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: data.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: data.S3_FORCE_PATH_STYLE,
    appUrl: data.APP_URL,
    appTestMode: data.APP_TEST_MODE,
    testAppPort: data.TEST_APP_PORT,
    nextDistDir: data.NEXT_DIST_DIR,
  };
}

/** Значения одного загруженного файла окружения. */
export interface DotenvFile {
  path: string;
  env: Record<string, string | undefined>;
}

/**
 * Загружает файлы `.env*` через `@next/env` и отдаёт их поимённо.
 * При `NODE_ENV=test` читаются `.env.test.local`, `.env.test`, `.env`
 * (без `.env.local`); иначе — `.env.<mode>.local`, `.env.local`,
 * `.env.<mode>`, `.env`. Значения файлов отдаются всегда: они нужны, чтобы
 * передать их дочернему процессу явно.
 */
export function loadDotenvFiles(): DotenvFile[] {
  const { loadedEnvFiles } = loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== "production",
  );
  return loadedEnvFiles.map((file) => ({ path: file.path, env: file.env }));
}

let cachedConfig: AppConfig | undefined;

/**
 * Загружает окружение и отдаёт типизированный объект.
 * Бросает `ConfigError`, если обязательная переменная отсутствует или некорректна.
 */
export function loadConfig(): AppConfig {
  if (cachedConfig === undefined) {
    loadDotenvFiles();
    cachedConfig = parseConfig(process.env);
  }
  return cachedConfig;
}

/**
 * Каталог сборки Next.js: нужен `next.config.ts` и на фазе сборки, где проверка
 * остальных переменных пропускается, поэтому читается без валидации.
 */
export function readNextDistDir(): string {
  loadDotenvFiles();
  const value = process.env.NEXT_DIST_DIR?.trim();
  return value === undefined || value === "" ? ".next" : value;
}
