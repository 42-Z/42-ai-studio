import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { withEve } from "eve/next";

import { loadConfig, readNextDistDir } from "./lib/config";

/**
 * Проверка конфигурации вызывается при каждом `next dev` и `next start`:
 * при отсутствующей или некорректной переменной сервер не стартует.
 * При `next build` проверка пропускается — сборка секретов не требует.
 */
const distDir = readNextDistDir();

const nextConfig: NextConfig = {
  distDir,
  // Next.js дописывает пути типов своего distDir в include tsconfig. Экземпляры
  // тестов со своим distDir работают с отдельным tsconfig, который создаёт
  // `startApp` (`<distDir>.tsconfig.json`, расширяет корневой), иначе каждый
  // прогон тестов менял бы tsconfig.json в репозитории.
  typescript: distDir === ".next" ? undefined : { tsconfigPath: `${distDir}.tsconfig.json` },
};

export default withEve((phase) => {
  if (phase !== PHASE_PRODUCTION_BUILD) {
    loadConfig();
  }
  return nextConfig;
});
