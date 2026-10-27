import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { withEve } from "eve/next";

import { loadConfig, readNextDistDir } from "./lib/config";

/**
 * Проверка конфигурации вызывается при каждом `next dev` и `next start`:
 * при отсутствующей или некорректной переменной сервер не стартует.
 * При `next build` проверка пропускается — сборка секретов не требует.
 */
const nextConfig: NextConfig = {
  distDir: readNextDistDir(),
};

export default withEve((phase) => {
  if (phase !== PHASE_PRODUCTION_BUILD) {
    loadConfig();
  }
  return nextConfig;
});
