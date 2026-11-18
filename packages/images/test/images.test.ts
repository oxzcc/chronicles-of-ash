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
    expect(calls[0]!.body).toMatchObject({ sync_mode: true, image_size: { width: 1024, height: 1024 }, seed: 3 });
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
    // Узкая срезанная шляпа сверху — уже перерисовка; локоть у бокового края — ещё нет.
    expect(await clippedShare(await png(`<rect x="90" y="0" width="12" height="200" fill="#800"/>`))).toBeGreaterThan(CLIP_LIMIT);
    expect(await clippedShare(await png(`<rect x="0" y="150" width="60" height="6" fill="#800"/>`))).toBeLessThanOrEqual(CLIP_LIMIT);
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
    expect(cfg.loraModel).toBe("fal-ai/flux-2/klein/9b/base/lora");
    expect(new FalImageProvider(cfg).loraFor("arkham")).toEqual({ url: "u", scale: 1 });
    expect(new FalImageProvider(cfg).loraFor("fantasy")).toBeUndefined();
  });

  it("промпт с LoRA: портрет — строго в формате подписей датасета, фон — триггер, эпоха и запреты", async () => {
    const { backgroundPrompt, stylePart, baseHero } = await import("../src/index");
    const hero = baseHero(arkham, { race: "human", cls: "journalist", gender: "f" });
    expect(hero).toMatch(/^a woman newspaper reporter/);
    expect(portraitPrompt(arkham, hero, true)).toBe(`mthnr style, three-quarter portrait of ${hero}, plain light grey background`);
    const bg = backgroundPrompt(arkham, "x", "night", true);
    expect(bg).toMatch(/^mthnr style, /);
    expect(bg).toMatch(/1926/);
    expect(bg).not.toMatch(/gouache/);
    // Без LoRA и у мира без триггера — прежний префикс.
    expect(portraitPrompt(arkham, "man")).toMatch(/gouache/);
    expect(stylePart(world, true)).toBe(world.art.stylePrefix);
  });

  it("NPC мира с LoRA описывается как подпись датасета: пол в существительном, без точки и заглавной", async () => {
    const { describeNpc, buildFor } = await import("../src/index");
    const asked: string[] = [];
    const reply = (text: string): any => ({ route: () => ({ model: "m", provider: { complete: async (r: any) => (asked.push(r.messages[0].content), { text, toolCalls: [], usage: {}, model: "m" }) } }) });
    const card = { name: "Лорейн Вейл", race: "human" as const, gender: "f" as const, role: "вдова" };
    expect(await describeNpc(reply("A grieving young widow, slender, black veil, frightened."), arkham, card)).toBe("a grieving young widow, slender, black veil, frightened");
    expect(asked[0]).toMatch(/one noun phrase with age, gender and role/);
    // Телосложение выбрал код по правилам мира: три готовых варианта по возрасту и состоянию.
    const b = buildFor(arkham, card)!;
    expect(asked[0]).toContain(`otherwise — '${b.young}'`);
    expect(asked[0]).toContain(`if sick, starving or drowned — 'thin frail build'`);
    // Пол не назван — ставим его первым словом.
    expect(await describeNpc(reply("an elderly housekeeper, stout sturdy build"), arkham, card)).toBe("a woman, an elderly housekeeper, stout sturdy build");
    // У мира без LoRA — прежний вид: пол и раса впереди.
    expect(await describeNpc(reply("tall, scarred"), world, { ...card, race: "elf" })).toMatch(/^a woman, female character, .+, tall, scarred$/);
  });

  it("телосложение NPC выбирает код: по имени всегда одно, доли мира, роковые роли", async () => {
    const { buildFor } = await import("../src/index");
    const fig = arkham.art.figures!;
    const [curvy, hourglass] = [fig.young.f[0]!.en, fig.young.f[1]!.en];
    // Один и тот же NPC — всегда одна фигура.
    expect(buildFor(arkham, { name: "Мэри Хоббс", gender: "f" })).toEqual(buildFor(arkham, { name: "Мэри Хоббс", gender: "f" }));
    // Доли: 4/9 с формами, 2/9 «песочные часы», треть стройные.
    const n = 3000;
    const picks = Array.from({ length: n }, (_, i) => buildFor(arkham, { name: `Жительница ${i}`, gender: "f" })!.young);
    const share = (x: string) => picks.filter((p) => p === x).length / n;
    expect(share(curvy)).toBeCloseTo(4 / 9, 1);
    expect(share(hourglass)).toBeCloseTo(2 / 9, 1);
    expect(1 - share(curvy) - share(hourglass)).toBeCloseTo(1 / 3, 1);
    // Пожилые — без утрирования.
    for (let i = 0; i < 50; i++) expect(buildFor(arkham, { name: `Старуха ${i}`, gender: "f" })!.elderly).not.toMatch(/bust/);
    // Певица — всегда «песочные часы»; у мира без правил выбора нет.
    for (let i = 0; i < 20; i++) expect(buildFor(arkham, { name: `Певица ${i}`, gender: "f", role: "певица в подпольном баре" })!.young).toBe(hourglass);
    expect(buildFor(world, { name: "x", gender: "f" })).toBeUndefined();
  });

  it("облики героя: разные фигуры, наряды и позы; фигуры нет в подписи; слова игрока важнее", async () => {
    const { heroVariants, baseHero } = await import("../src/index");
    const { mulberry32 } = await import("@ash/engine");
    const fig = arkham.art.figures!;
    const failing: any = { route: () => ({ model: "m", provider: { complete: async () => { throw new Error("down"); } } }) };
    const d = { race: "human" as const, cls: "journalist", gender: "f" as const };
    const v = await heroVariants(failing, arkham, d, "", undefined, mulberry32(7));
    // Фигуры — в порядке мира, по одной на облик.
    v.forEach((x, i) => expect(x.prompt).toContain(fig.hero.f[i]!));
    // Наряды — четыре разных из списка класса, и именно они идут в основу вместо classEn.
    expect(new Set(v.map((x) => x.outfit)).size).toBe(4);
    for (const x of v) expect(arkham.art.heroOutfitsEn!.journalist).toContain(x.outfit);
    expect(baseHero(arkham, d, v[1]!.outfit)).toBe(`a woman ${v[1]!.outfit}`);
    // Позы — четыре разные: последний кусок промпта.
    expect(new Set(v.map((x) => x.prompt.split(", ").slice(-1)[0])).size).toBe(4);
    // В подписи нет телосложения.
    for (const x of v) expect(x.label).not.toMatch(/форм|пышн|строй|спортив/);
    // Модель всё же вписала фигуру в подпись — убираем.
    const chatty: any = { route: () => ({ model: "m", provider: { complete: async () => ({ text: JSON.stringify(Array.from({ length: 4 }, (_, i) => ({ label: `Молодая, рыжая ${i}, с формами`, prompt: `woman in her twenties, red hair ${i}` }))) }) } }) };
    for (const x of await heroVariants(chatty, arkham, d, "", undefined, mulberry32(1))) expect(x.label).toMatch(/^Молодая, рыжая \d$/);
    // Цвет волос и приметы раздаёт код: четыре разных цвета, примета у одного-двух; без «walking» в позах.
    let asked = "";
    const spy: any = { route: () => ({ model: "m", provider: { complete: async (r: any) => { asked = r.messages[0].content; throw new Error("down"); } } }) };
    for (let seed = 1; seed <= 20; seed++) {
      const vv = await heroVariants(spy, arkham, d, "", undefined, mulberry32(seed));
      const hairs = [...asked.matchAll(/years old, ([a-z -]+?) hair/g)].map((m) => m[1]);
      expect(new Set(hairs).size).toBe(4);
      const marked = (asked.match(/one noticeable scar/g) ?? []).length;
      expect(marked).toBeGreaterThanOrEqual(1);
      expect(marked).toBeLessThanOrEqual(2);
      for (const x of vv) expect(x.prompt).not.toMatch(/walking/);
      // Возраст: четыре разных, кто-то моложе 32 и кто-то старше 45; облик с формами — не старше 45.
      const ages = [...asked.matchAll(/(\d+) years old/g)].map((m) => Number(m[1]));
      expect(ages).toHaveLength(4);
      expect(Math.min(...ages)).toBeLessThan(32);
      expect(Math.max(...ages)).toBeGreaterThan(45);
      expect(ages[0]).toBeLessThanOrEqual(45);
    }
    // Свои слова игрока о волосах и приметах — важнее.
    await heroVariants(spy, arkham, d, "рыжая, шрам через бровь", undefined, mulberry32(5));
    expect(asked).not.toMatch(/[a-z-]+ hair(,|;|\.| streaked)|noticeable scar|clean face/);
    await heroVariants(spy, arkham, d, "пожилая", undefined, mulberry32(6));
    expect(asked).not.toMatch(/\d\) \d+ years old/);
    // Игрок сам описал фигуру и одежду — их не навязываем.
    const own = await heroVariants(failing, arkham, d, "худая, высокая, в потёртом кожаном плаще", undefined, mulberry32(3));
    for (const x of own) {
      expect(x.prompt).not.toMatch(/bust|slender|athletic|plump/);
      expect(x.outfit).toBeUndefined();
    }
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
    // Фон — 1920×1088 (на больших экранах 1024×576 мылится), цена — за мегапиксели.
    expect(calls[0]!.body.image_size).toEqual({ width: 1920, height: 1088 });
    expect(a.costUsd).toBeCloseTo(0.01 * 1.92 * 1.088, 5);

    calls.length = 0;
    const f = await renderBackground({ world, provider, storage, description: "a ruined keep", time: "dusk", key: "bg/f", seed: 1 });
    expect(calls[0]!.url).toBe("https://fal.run/fal-ai/flux-2/klein/4b");
    expect(calls[0]!.body.loras).toBeUndefined();
    expect(f.prompt.startsWith(world.art.stylePrefix)).toBe(true);

    // Портрет с LoRA — 2:3, как датасет; без LoRA — прежний квадрат.
    calls.length = 0;
    const { renderPortrait } = await import("../src/index");
    const pa = await renderPortrait({ world: arkham, provider, storage, description: "a woman librarian", key: "npc/a", seed: 1 });
    expect(calls[0]!.body.image_size).toEqual({ width: 1024, height: 1536 });
    expect(pa.prompt).toBe("mthnr style, three-quarter portrait of a woman librarian, plain light grey background");
    calls.length = 0;
    await renderPortrait({ world, provider, storage, description: "a woman, female character, elf", key: "npc/f", seed: 1 });
    expect(calls[0]!.body.image_size).toEqual({ width: 1024, height: 1024 });
  });
});
