import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/** Хранилище готовых картинок. Локально — папка; на сервере (фаза 4) — S3 + CDN с тем же интерфейсом. */
export interface ImageStorage {
  put(key: string, bytes: Buffer, contentType?: string): Promise<string>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]{0,200}\.(webp|png|jpg)$/;

export class LocalStorage implements ImageStorage {
  constructor(private readonly dir: string, private readonly publicPrefix = "/api/images/") {}

  async put(key: string, bytes: Buffer): Promise<string> {
    if (!SAFE_KEY.test(key)) throw new Error(`Bad image key: ${key}`);
    const path = join(this.dir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return this.publicPrefix + key;
  }

  /** Для раздачи файлов из Next.js — с защитой от выхода за пределы папки. */
  async read(key: string): Promise<Buffer | null> {
    if (!SAFE_KEY.test(key) || normalize(key).startsWith("..")) return null;
    try {
      return await readFile(join(this.dir, key));
    } catch {
      return null;
    }
  }
}
