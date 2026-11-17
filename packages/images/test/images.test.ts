import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { getWorld } from "@ash/worlds";
import { describe, expect, it } from "vitest";
import { createRouter } from "@ash/llm";
import {
  FakeImageProvider, FalImageProvider, heroVariants, LocalStorage, renderBackground, renderPortrait, describeNpc, portraitPrompt,
} from "../src/index";

const world = getWorld("fantasy");

const fakeRouter = () => createRouter({ fake: true, models: { narratorPaid: "p", narratorFree: "f", utility: "u" } });

describe("конвейер картинок", () => {
  it("портрет: фон вырезан, целый квадратный холст, webp с прозрачностью", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ash-img-"));
    const storage = new LocalStorage(dir);
    const r = await renderPortrait({ world, provider: new FakeImageProvider(), storage, description: "man, human, tavern keeper", key: "npc/test-godric" });
    expect(r.url).toBe("/api/images/npc/test-godric.webp");
    const bytes = (await storage.read("npc/test-godric.webp"))!;
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBe(meta.height); // холст не обрезан — один масштаб у всех
    expect(r.redrawn).toBe(false); // силуэт внутри кадра
    const { data } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // угол прозрачный
    expect(r.prompt).toContain("light grey studio background");
  });
  it("фон: webp, приглушён", async () => {
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), "ash-img-")));
    const r = await renderBackground({ world, provider: new FakeImageProvider(), storage, description: "a tavern", time: "night", key: "bg/tavern-1" });
    expect(r.width).toBe(1344);
    expect(r.prompt).toMatch(/no people.*night/);
  });
  it("хранилище не выпускает за пределы папки", async () => {
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), "ash-img-")));
    await expect(storage.put("../etc/passwd.png", Buffer.from(""))).rejects.toThrow();
    expect(await storage.read("../../x.png")).toBeNull();
  });
});

describe("описания для FLUX", () => {
  it("без ответа служебной модели — 4 заметно разных облика из запаса", async () => {
    const v = await heroVariants(fakeRouter(), world, { race: "human", cls: "ranger", gender: "f" }, "");
    expect(v).toHaveLength(4);
    expect(new Set(v.map((x) => x.prompt)).size).toBe(4);
  });
  it("NPC без ответа модели — английский промпт из данных", async () => {
    const d = await describeNpc(fakeRouter(), world, { name: "Годрик", race: "dwarf", gender: "m", role: "трактирщик" });
    expect(d).toMatch(/^a man, male character, stocky dwarf/);
    expect(/[а-я]/i.test(portraitPrompt(world, d))).toBe(false);
  });
});

describe("fal", () => {
  it("sync_mode: картинка из data URI, вырезание через BiRefNet Portrait", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#888" } }).png().toBuffer();
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const key = url.includes("birefnet") ? "image" : "images";
      const img = { url: `data:image/png;base64,${png.toString("base64")}` };
      return new Response(JSON.stringify({ [key]: key === "image" ? img : [img] }));
    }) as unknown as typeof fetch;
    const p = new FalImageProvider({ key: "k", portraitModel: "fal-ai/flux-2/klein/4b", backgroundModel: "fal-ai/flux-2/klein/4b", cutoutModel: "fal-ai/birefnet/v2", fetchImpl });
    const g = await p.generate({ prompt: "x", shape: "portrait", quality: "portrait", seed: 3 });
    const c = await p.removeBackground(g.bytes);
    expect(g.bytes.equals(png)).toBe(true);
    expect(calls[0]!.body).toMatchObject({ sync_mode: true, image_size: "square_hd", seed: 3 });
    expect(calls[1]!.url).toBe("https://fal.run/fal-ai/birefnet/v2");
    expect(calls[1]!.body).toMatchObject({ model: "Portrait", output_format: "png" });
    expect(c.costUsd).toBeGreaterThan(0);
  });
});

describe("raceEn", () => {
  it("дварфийка без бороды, дварф с бородой", async () => {
    const { raceEn } = await import("../src/style");
    expect(raceEn(world, "dwarf", "f")).toContain("beardless");
    expect(raceEn(world, "dwarf", "m")).toContain("beard");
    expect(raceEn(world, "elf", "f")).toBe("elf with pointed ears");
  });
});

describe("clippedShare", () => {
  it("силуэт внутри кадра — 0, упёрся в верх — больше лимита", async () => {
    const sharp = (await import("sharp")).default;
    const { clippedShare, CLIP_LIMIT } = await import("../src/process");
    const png = (svg: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300">${svg}</svg>`)).png().toBuffer();
    expect(await clippedShare(await png(`<rect x="50" y="40" width="100" height="260" fill="#800"/>`))).toBe(0);
    expect(await clippedShare(await png(`<rect x="20" y="0" width="160" height="300" fill="#800"/>`))).toBeGreaterThan(CLIP_LIMIT);
  });
});

describe("стиль по мирам", () => {
  const arkham = getWorld("arkham");
  it("Аркхэм рисуется в 1920-х, без средневековья и фэнтези-рас", async () => {
    const { backgroundPrompt, baseHero } = await import("../src/index");
    const p = portraitPrompt(arkham, baseHero(arkham, { race: "human", cls: "detective", gender: "f" }));
    expect(p).toMatch(/1920s/);
    expect(p).toMatch(/trench coat/);
    expect(p).not.toMatch(/medieval|dark fantasy|ember/);
    expect(backgroundPrompt(arkham, "x", "dusk")).toMatch(/gas street lamps/);
  });
  it("описание места для FLUX просит предметы 1926 года", async () => {
    const { describeLocation } = await import("../src/index");
    const asked: string[] = [];
    const router: any = { route: () => ({ model: "m", provider: { complete: async (r: any) => (asked.push(r.messages[0].content), { text: "a foggy wharf at night", toolCalls: [], usage: {}, model: "m" }) } }) };
    const d = await describeLocation(router, arkham, { name: "Пристань", type: "docks", desc: "Туман" });
    expect(asked[0]).toMatch(/Only objects of 1926/);
    expect(d).toMatch(/^river wharf/);
  });
});

describe("LoRA стиля", () => {
  const arkham = getWorld("arkham");
  const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: "#ccc" } }).png().toBuffer();

  it("переменные окружения: URL и сила по id мира, без URL LoRA нет", async () => {
    const { falConfigFromEnv, lorasFromEnv } = await import("../src/index");
    expect(lorasFromEnv({ FAL_LORA_ARKHAM_URL: " https://x/l.safetensors ", FAL_LORA_ARKHAM_SCALE: "0.8", FAL_LORA_FANTASY_URL: "" })).toEqual({
      arkham: { url: "https://x/l.safetensors", scale: 0.8 },
    });
    expect(lorasFromEnv({ FAL_LORA_ARKHAM_URL: "u", FAL_LORA_ARKHAM_SCALE: "9" }).arkham!.scale).toBe(2);
    expect(lorasFromEnv({ FAL_LORA_ARKHAM_URL: "u", FAL_LORA_ARKHAM_SCALE: "abc" }).arkham!.scale).toBe(1);
    const cfg = falConfigFromEnv({ FAL_KEY: "k", FAL_LORA_ARKHAM_URL: "u" })!;
    expect(cfg.loraModel).toBe("fal-ai/flux-2/klein/9b/lora");
    expect(new FalImageProvider(cfg).loraFor("arkham")).toEqual({ url: "u", scale: 1 });
    expect(new FalImageProvider(cfg).loraFor("fantasy")).toBeUndefined();
  });

  it("промпт с LoRA: триггер первым, вместо техники — эпоха и запреты", async () => {
    const { backgroundPrompt, stylePart } = await import("../src/index");
    const p = portraitPrompt(arkham, "man", true);
    expect(p.startsWith(`${arkham.art.lora!.trigger}, `)).toBe(true);
    expect(p).toMatch(/1926/);
    expect(p).not.toMatch(/gouache/);
    expect(backgroundPrompt(arkham, "x", "night", true)).toMatch(/^mthnr style, /);
    // Без LoRA и у мира без триггера — прежний префикс.
    expect(portraitPrompt(arkham, "man")).toMatch(/gouache/);
    expect(stylePart(world, true)).toBe(world.art.stylePrefix);
  });

  it("конвейер шлёт LoRA в fal только миру, для которого она задана", async () => {
    const img = await png();
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const d = { url: `data:image/png;base64,${img.toString("base64")}` };
      return new Response(JSON.stringify(url.includes("birefnet") ? { image: d } : { images: [d] }));
    }) as unknown as typeof fetch;
    const provider = new FalImageProvider({
      key: "k", portraitModel: "fal-ai/flux-2/klein/4b", backgroundModel: "fal-ai/flux-2/klein/4b", cutoutModel: "fal-ai/birefnet/v2",
      loraModel: "fal-ai/flux-2/klein/4b/lora", loras: { arkham: { url: "https://w/l.safetensors", scale: 0.7 } }, fetchImpl,
    });
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), "ash-lora-")));

    const a = await renderBackground({ world: arkham, provider, storage, description: "a foggy wharf", time: "night", key: "bg/a", seed: 1 });
    expect(calls[0]!.url).toBe("https://fal.run/fal-ai/flux-2/klein/4b/lora");
    expect(calls[0]!.body.loras).toEqual([{ path: "https://w/l.safetensors", scale: 0.7 }]);
    expect(a.prompt).toMatch(/^mthnr style, /);
    expect(a.model).toBe("fal-ai/flux-2/klein/4b/lora");

    calls.length = 0;
    const f = await renderBackground({ world, provider, storage, description: "a ruined keep", time: "dusk", key: "bg/f", seed: 1 });
    expect(calls[0]!.url).toBe("https://fal.run/fal-ai/flux-2/klein/4b");
    expect(calls[0]!.body.loras).toBeUndefined();
    expect(f.prompt.startsWith(world.art.stylePrefix)).toBe(true);
  });
});
