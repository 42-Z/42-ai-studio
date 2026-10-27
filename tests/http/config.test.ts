/**
 * Точечные тесты чистой функции проверки конфигурации: приложение не нужно.
 */
import { describe, expect, test } from "vitest";

import { ConfigError, parseConfig, type EnvRecord } from "../../lib/config";

/** Полный набор корректных переменных для перекрытия в отдельных тестах. */
function validEnv(): EnvRecord {
  return {
    DATABASE_URL: "postgres://studio:studio@localhost:55432/studio_test",
    S3_ENDPOINT: "http://localhost:59000",
    S3_REGION: "us-east-1",
    S3_BUCKET: "studio-test",
    S3_ACCESS_KEY_ID: "minioadmin",
    S3_SECRET_ACCESS_KEY: "minioadmin",
    S3_FORCE_PATH_STYLE: "true",
    APP_URL: "http://localhost:3100",
    APP_TEST_MODE: "1",
    TEST_APP_PORT: "3100",
    NEXT_DIST_DIR: ".next-test-3100",
    NODE_ENV: "test",
  };
}

function issuesOf(env: EnvRecord): readonly string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("ожидалась ошибка конфигурации");
}

describe("parseConfig", () => {
  test("принимает полный набор переменных и разбирает их", () => {
    const config = parseConfig(validEnv());

    expect(config.databaseUrl).toBe("postgres://studio:studio@localhost:55432/studio_test");
    expect(config.s3Endpoint).toBe("http://localhost:59000");
    expect(config.s3Region).toBe("us-east-1");
    expect(config.s3Bucket).toBe("studio-test");
    expect(config.s3AccessKeyId).toBe("minioadmin");
    expect(config.s3SecretAccessKey).toBe("minioadmin");
    expect(config.s3ForcePathStyle).toBe(true);
    expect(config.appUrl).toBe("http://localhost:3100");
    expect(config.appTestMode).toBe(true);
    expect(config.testAppPort).toBe(3100);
    expect(config.nextDistDir).toBe(".next-test-3100");
  });

  test("APP_TEST_MODE=1 при NODE_ENV=production отвергается", () => {
    const issues = issuesOf({ ...validEnv(), NODE_ENV: "production" });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("APP_TEST_MODE");
  });

  test("отсутствующая обязательная переменная называется в ошибке", () => {
    for (const name of [
      "DATABASE_URL",
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "APP_URL",
    ] as const) {
      const env = validEnv();
      delete env[name];

      const issues = issuesOf(env);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain(name);
    }
  });

  test("пустая строка — как отсутствующая переменная", () => {
    const issues = issuesOf({ ...validEnv(), DATABASE_URL: "   " });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("DATABASE_URL");
    expect(issues[0]).toContain("не задана");
  });

  test("логические значения разбирает один помощник: «false» — это false", () => {
    expect(parseConfig({ ...validEnv(), S3_FORCE_PATH_STYLE: "false" }).s3ForcePathStyle).toBe(
      false,
    );
    expect(parseConfig({ ...validEnv(), S3_FORCE_PATH_STYLE: "0" }).s3ForcePathStyle).toBe(false);
    expect(parseConfig({ ...validEnv(), APP_TEST_MODE: "false" }).appTestMode).toBe(false);
  });

  test("некорректное логическое значение отвергается с именем переменной", () => {
    const issues = issuesOf({ ...validEnv(), S3_FORCE_PATH_STYLE: "yes" });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("S3_FORCE_PATH_STYLE");
  });

  test("APP_URL с завершающим / отвергается с сообщением", () => {
    const issues = issuesOf({ ...validEnv(), APP_URL: "http://localhost:3100/" });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("APP_URL");
    expect(issues[0]).toContain("/");
  });

  test("DATABASE_URL и S3_ENDPOINT проверяются по форме URL", () => {
    expect(issuesOf({ ...validEnv(), DATABASE_URL: "не URL" })[0]).toContain("DATABASE_URL");
    expect(issuesOf({ ...validEnv(), S3_ENDPOINT: "localhost:59000" })[0]).toContain("S3_ENDPOINT");
  });

  test("необязательные переменные получают значения по умолчанию", () => {
    const env = validEnv();
    delete env.S3_FORCE_PATH_STYLE;
    delete env.APP_TEST_MODE;
    delete env.TEST_APP_PORT;
    delete env.NEXT_DIST_DIR;

    const config = parseConfig(env);

    expect(config.s3ForcePathStyle).toBe(false);
    expect(config.appTestMode).toBe(false);
    expect(config.testAppPort).toBe(3100);
    expect(config.nextDistDir).toBe(".next");
  });

  test("TEST_APP_PORT принимает только целые числа в диапазоне", () => {
    expect(issuesOf({ ...validEnv(), TEST_APP_PORT: "70000" })[0]).toContain("TEST_APP_PORT");
    expect(issuesOf({ ...validEnv(), TEST_APP_PORT: "port" })[0]).toContain("TEST_APP_PORT");
    expect(parseConfig({ ...validEnv(), TEST_APP_PORT: "3199" }).testAppPort).toBe(3199);
  });
});
