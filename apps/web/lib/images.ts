import { resolve } from "node:path";
import { startWorker, type VisualDeps } from "@ash/game";
import { FakeImageProvider, FalImageProvider, falConfigFromEnv, LocalStorage } from "@ash/images";
import { configFromEnv, createRouter } from "@ash/llm";
import { createDb } from "@ash/db";

/**
 * Картинки: fal, если есть FAL_KEY, иначе фейковые (градиенты и силуэты).
 * Хранилище — папка data/images в корне проекта; на сервере (фаза 4) — S3.
 */
export const imagesDir = () => process.env.IMAGES_DIR ?? resolve(process.cwd(), "../../data/images");

let storage: LocalStorage | null = null;
export const getStorage = () => (storage ??= new LocalStorage(imagesDir()));

export function imagesAreFake() {
  return !falConfigFromEnv();
}

/** Воркер очереди картинок — один на процесс сервера (запускается из instrumentation.ts). */
export function startImageWorker() {
  const g = globalThis as { __ashImageWorker?: boolean };
  if (g.__ashImageWorker || !process.env.DATABASE_URL) return;
  g.__ashImageWorker = true;
  const fal = falConfigFromEnv();
  const deps: VisualDeps = {
    db: createDb().db,
    router: createRouter(configFromEnv()),
    provider: fal ? new FalImageProvider(fal) : new FakeImageProvider(800),
    storage: getStorage(),
  };
  console.log(`[images] worker started (${fal ? "fal" : "fake"}), dir ${imagesDir()}`);
  void startWorker(deps, { concurrency: Number(process.env.IMAGES_CONCURRENCY ?? 4) });
}
