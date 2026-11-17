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
