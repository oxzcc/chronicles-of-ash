import type { NextConfig } from "next";

const config: NextConfig = {
  // Пакеты монорепозитория — исходники на TypeScript, Next собирает их сам.
  transpilePackages: ["@ash/engine", "@ash/llm", "@ash/db"],
  serverExternalPackages: ["pg"],
};

export default config;
