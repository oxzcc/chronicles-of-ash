import type { NextConfig } from "next";
import { resolve } from "node:path";

// Ключи и адрес базы лежат в .env в корне проекта, а Next.js по умолчанию ищет его в apps/web.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  // Файла нет — работаем на переменных окружения сервера или фейковой модели.
}

const config: NextConfig = {
  // Пакеты монорепозитория — исходники на TypeScript, Next собирает их сам.
  transpilePackages: ["@ash/engine", "@ash/llm", "@ash/db", "@ash/game", "@ash/images"],
  serverExternalPackages: ["pg", "sharp"],
};

export default config;
