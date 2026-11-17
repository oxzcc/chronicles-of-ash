/**
 * Датасет LoRA стиля мира: картинки + подписи → zip для тренера fal.
 *
 *   pnpm lora:dataset -- --world arkham
 *
 * Берёт картинки из data/lora/<мир>/ (по алфавиту) и подписи из data/lora/<мир>_captions.json:
 * { "trigger": "...", "captions": { "01": "...", "02": "..." } } — номер = место картинки в алфавитном списке.
 * Пишет data/lora/<мир>_dataset/ (<мир>_001.png + .txt, _source.json — исходные имена) и <мир>_dataset.zip.
 * Картинки и подписи в git не попадают (data/ в .gitignore).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const world = arg("world", "arkham");
const root = arg("dir", "data/lora");
const src = join(root, world);
const out = join(root, `${world}_dataset`);
const zip = join(root, `${world}_dataset.zip`);

const { trigger, captions } = JSON.parse(readFileSync(join(root, `${world}_captions.json`), "utf8")) as {
  trigger: string;
  captions: Record<string, string>;
};
const images = readdirSync(src)
  .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  .sort();

const missing = images.map((_, i) => String(i + 1).padStart(2, "0")).filter((n) => !captions[n]?.trim());
if (images.length === 0) throw new Error(`В ${src} нет картинок`);
if (missing.length) throw new Error(`Нет подписей для номеров: ${missing.join(", ")}`);
if (Object.keys(captions).length !== images.length)
  throw new Error(`Картинок ${images.length}, подписей ${Object.keys(captions).length} — список изменился, обнови подписи`);

if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
const source: Record<string, string> = {};
const files: string[] = [];
images.forEach((f, i) => {
  const name = `${world}_${String(i + 1).padStart(3, "0")}`;
  const img = join(out, name + extname(f).toLowerCase());
  copyFileSync(join(src, f), img);
  writeFileSync(join(out, `${name}.txt`), `${trigger}, ${captions[String(i + 1).padStart(2, "0")]!.trim()}`);
  files.push(img, join(out, `${name}.txt`));
  source[name] = f;
});
writeFileSync(join(out, "_source.json"), JSON.stringify(source, null, 1));

// Плоский zip без сжатия: PNG и так сжаты, а тренеру нужны файлы в корне архива.
if (existsSync(zip)) rmSync(zip);
execFileSync("zip", ["-j", "-q", "-0", zip, ...files]);
console.log(`Готово: картинок — ${images.length}, архив ${zip}`);
