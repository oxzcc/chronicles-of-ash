import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { getWorld } from "@ash/worlds";
import { describe, expect, it } from "vitest";
import { createRouter } from "@ash/llm";
import {
  DEFAULT_EDIT_MODEL, editPrompt, FakeImageProvider, FalImageProvider, heroVariants, LocalStorage, lookFromPrompt, renderBackground, renderPortrait, renderVariant,
  describeNpc, portraitPrompt,
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
    expect(portraitPrompt(arkham, hero, true)).toBe(`mthnr style, waist-up portrait of ${hero}, plain light grey background`);
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

  it("телосложение NPC выбирает код: по имени всегда одно, естественное разнообразие без шаблонов по роли", async () => {
    const { buildFor } = await import("../src/index");
    const fig = arkham.art.figures!;
    // Один и тот же NPC — всегда одна фигура.
    expect(buildFor(arkham, { name: "Мэри Хоббс", gender: "f" })).toEqual(buildFor(arkham, { name: "Мэри Хоббс", gender: "f" }));
    // Средняя фигура имеет вес 2 из 6, остальные четыре — по 1; все варианты реально встречаются.
    const n = 3000;
    const picks = Array.from({ length: n }, (_, i) => buildFor(arkham, { name: `Жительница ${i}`, gender: "f" })!.young);
    const share = (x: string) => picks.filter((p) => p === x).length / n;
    expect(share(fig.young.f[0]!.en)).toBeCloseTo(1 / 3, 1);
    expect(new Set(picks)).toEqual(new Set(fig.young.f.map((x) => x.en)));
    // Пожилые и взрослые — без гипертрофированных или сексуализированных описаний.
    for (let i = 0; i < 50; i++) {
      const b = buildFor(arkham, { name: `Жительница ${i}`, gender: "f" })!;
      expect(`${b.young} ${b.elderly}`).not.toMatch(/bust|voluptuous|hourglass|wide hips/i);
    }
    // Профессия не назначает особый силуэт: певица получает ту же детерминированную фигуру, что и без роли.
    for (let i = 0; i < 20; i++) {
      const who = { name: `Певица ${i}`, gender: "f" as const };
      expect(buildFor(arkham, { ...who, role: "певица в подпольном баре" })).toEqual(buildFor(arkham, who));
    }
    expect(buildFor(world, { name: "x", gender: "f" })).toBeUndefined();
  });

  it("облики героя: разные фигуры, наряды и позы; фигуры нет в подписи; слова игрока важнее", async () => {
    const { heroVariants, baseHero } = await import("../src/index");
    const { mulberry32 } = await import("@ash/engine");
    const fig = arkham.art.figures!;
    const failing: any = { route: () => ({ model: "m", provider: { complete: async () => { throw new Error("down"); } } }) };
    const d = { race: "human" as const, cls: "journalist", gender: "f" as const };
    const v = await heroVariants(failing, arkham, d, "", undefined, mulberry32(7));
    // Фигуры — все четыре из мира, по одной на облик, но в случайном порядке.
    expect(fig.hero.f.every((b) => v.some((x) => x.prompt.includes(b)))).toBe(true);
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const vv = await heroVariants(failing, arkham, d, "", undefined, mulberry32(seed));
      firsts.add(fig.hero.f.findIndex((b) => vv[0]!.prompt.includes(b)));
    }
    expect(firsts.size).toBeGreaterThan(2);
    // Наряды героини — четыре разных из женского списка класса (слой подставлен), поза — сразу после наряда.
    const list = arkham.art.heroOutfitsFemaleEn!.journalist!;
    expect(new Set(v.map((x) => x.outfit)).size).toBe(4);
    for (const x of v) {
      expect(list.some((o) => x.outfit!.startsWith(o.split(" {under}")[0]!.split(",")[0]!))).toBe(true);
      expect(x.outfit).not.toMatch(/\{under\}/);
      expect(x.outfit).toMatch(/the object/);
      expect(x.prompt).not.toMatch(/the object/);
    }
    expect(baseHero(arkham, d, v[1]!.outfit)).toBe(`a woman ${v[1]!.outfit}`);
    // Позы — четыре разные; ни одной «one hand … the other» с предметом у воротника.
    const poses = v.map((x) => x.outfit!.slice(x.outfit!.lastIndexOf(", ") + 2));
    expect(new Set(v.map((x) => x.outfit!.split("the object")[0])).size).toBe(4);
    for (const p of poses) expect(p).not.toMatch(/collar/);
    // Мужчина-журналист — по общему списку, без меток слоя.
    const m = await heroVariants(failing, arkham, { ...d, gender: "m" }, "", undefined, mulberry32(7));
    for (const x of m) expect(arkham.art.heroOutfitsEn!.journalist!.some((o) => x.outfit!.startsWith(o))).toBe(true);
    // В подписи нет телосложения.
    for (const x of v) expect(x.label).not.toMatch(/форм|пышн|строй|спортив/);
    // Модель всё же вписала фигуру в подпись — убираем.
    const chatty: any = { route: () => ({ model: "m", provider: { complete: async () => ({ text: JSON.stringify(Array.from({ length: 4 }, (_, i) => ({ label: `Молодая, рыжая ${i}, с формами`, prompt: `woman in her twenties, red hair ${i}` }))) }) } }) };
    for (const x of await heroVariants(chatty, arkham, d, "", undefined, mulberry32(1))) expect(x.label).toMatch(/^Молодая, рыжая \d$/);
    // Цвет волос, причёску, приметы и выражение раздаёт код.
    let asked = "";
    const spy: any = { route: () => ({ model: "m", provider: { complete: async (r: any) => { asked = r.messages[0].content; throw new Error("down"); } } }) };
    for (let seed = 1; seed <= 20; seed++) {
      const vv = await heroVariants(spy, arkham, d, "", undefined, mulberry32(seed));
      const hairs = [...asked.matchAll(/years old, ([a-z -]+?) hair/g)].map((m) => m[1]);
      expect(new Set(hairs).size).toBe(4);
      // Рыжий — один цвет из десяти: в четвёрке не больше одной рыжей.
      expect(hairs.filter((h) => /red|auburn|copper/.test(h!)).length).toBeLessThanOrEqual(1);
      const styles = arkham.art.hairstylesEn!.f.filter((h) => asked.includes(h));
      expect(styles.length).toBe(4);
      // Приметы — у одной-двух, без шрамов, ожогов и ран.
      const marked = 4 - (asked.match(/a clean face without scars/g) ?? []).length;
      expect(marked).toBeGreaterThanOrEqual(1);
      expect(marked).toBeLessThanOrEqual(2);
      expect(asked.replace(/without scars, burns or marks/g, "")).not.toMatch(/\bscar|burn|wound/);
      // Выражения — четыре разных.
      expect(new Set([...asked.matchAll(/expression: ([a-z -]+)/g)].map((m) => m[1])).size).toBe(4);
      for (const x of vv) expect(x.outfit).not.toMatch(/walking/);
      // Возраст: четыре разных, кто-то моложе 32 и кто-то старше 45; юным — «youthful face».
      const ages = [...asked.matchAll(/(\d+) years old/g)].map((m) => Number(m[1]));
      expect(ages).toHaveLength(4);
      expect(Math.min(...ages)).toBeLessThan(32);
      expect(Math.max(...ages)).toBeGreaterThan(45);
      expect(asked).not.toMatch(/curvy|voluptuous|hourglass|large bust|seductive|sultry|coy/i);
      vv.forEach((x, i) => expect(/youthful face/.test(x.prompt)).toBe(ages[i]! < 32));
    }
    // Свои слова игрока о волосах и приметах — важнее.
    await heroVariants(spy, arkham, d, "рыжая, шрам через бровь", undefined, mulberry32(5));
    expect(asked).not.toMatch(/[a-z-]+ hair(,|;|\.| streaked)|clean face|laugh lines|mole|freckles/);
    expect(arkham.art.hairstylesEn!.f.some((h) => asked.includes(h))).toBe(false);
    await heroVariants(spy, arkham, d, "пожилая", undefined, mulberry32(6));
    expect(asked).not.toMatch(/\d\) \d+ years old/);
    // Игрок сам описал фигуру и одежду — их не навязываем, поза уходит в промпт.
    const own = await heroVariants(failing, arkham, d, "худая, высокая, в потёртом кожаном плаще", undefined, mulberry32(3));
    for (const x of own) {
      for (const b of fig.hero.f) expect(x.prompt).not.toContain(b);
      expect(x.outfit).toBeUndefined();
      expect(x.prompt).toMatch(/the object/);
    }
  });

  it("слой под верхней одеждой у героини: не больше одного свободного ворота, иногда ни одного", async () => {
    const { heroVariants } = await import("../src/index");
    const { mulberry32 } = await import("@ash/engine");
    const u = arkham.art.underlayersEn!;
    const failing: any = { route: () => ({ model: "m", provider: { complete: async () => { throw new Error("down"); } } }) };
    let sets = 0;
    let withOpen = 0;
    for (const cls of Object.keys(arkham.art.classEn))
      for (let seed = 1; seed <= 40; seed++) {
        const v = await heroVariants(failing, arkham, { race: "human", cls, gender: "f" }, "", undefined, mulberry32(seed * 31 + cls.length));
        const open = v.filter((x) => u.open.some((o) => x.outfit!.includes(o)));
        expect(open.length).toBeLessThanOrEqual(1);
        sets++;
        if (open.length) withOpen++;
        // Закрытый слой стоит у каждого наряда с верхней одеждой.
        for (const x of v) expect(x.outfit).not.toMatch(/\{under\}/);
      }
    // Открытый облик — в части наборов, а не во всех и не ни в одном.
    expect(withOpen / sets).toBeGreaterThan(0.15);
    expect(withOpen / sets).toBeLessThan(0.85);
    // Мужчины — без слоёв.
    const m = await heroVariants(failing, arkham, { race: "human", cls: "detective", gender: "m" }, "", undefined, mulberry32(1));
    for (const x of m) for (const l of [...u.open, ...u.closed]) expect(x.outfit).not.toContain(l);
  });

  it("NPC: причёска, цвет волос и слой — от кода по имени; поза одной фразой; приметы зажившие", async () => {
    const { describeNpc, guessNpc, npcStyle } = await import("../src/index");
    let asked = "";
    const reply: any = { route: () => ({ model: "m", provider: { complete: async (r: any) => ((asked = r.messages[0].content), { text: "a young woman maid, slim", toolCalls: [], usage: {}, model: "m" }) } }) };
    const card = { name: "Агата Мур", race: "human" as const, gender: "f" as const, role: "горничная" };
    await describeNpc(reply, arkham, card);
    const st = npcStyle(arkham, card);
    expect(npcStyle(arkham, card)).toEqual(st);
    expect(asked).toContain(st.hair!);
    expect(asked).toContain(st.under!.closed);
    expect(asked).toMatch(/ONE phrase that accounts for both hands/);
    expect(asked).toMatch(/nothing modern/);
    expect(asked).toMatch(/no dark circles/);
    // Возраст и примета — от кода: модель не делает всех молодыми и не ставит всем родинку из примера.
    expect(asked).toContain(`age: ${st.age}`);
    expect(asked).toContain(`face: '${st.mark}'`);
    expect(asked).not.toMatch(/youthful|small mole|beauty mark/);
    const many = Array.from({ length: 400 }, (_, i) => npcStyle(arkham, { name: `Н${i}`, gender: "f" }));
    expect(many.filter((x) => x.age!.includes("twenties")).length / 400).toBeLessThan(0.4);
    expect(many.filter((x) => x.mark!.includes("clean face")).length / 400).toBeCloseTo(0.55, 1);
    // Слой — только под распахнутой верхней одеждой, не под платьем.
    expect(asked).toMatch(/ONLY if they wear an open coat/);
    // Мастер описал лицо и возраст — их не задаём.
    await describeNpc(reply, arkham, { ...card, look: "пожилая, со шрамом" });
    expect(asked).not.toContain("age: in their");
    expect(asked).toMatch(/faint, pale and healed/);
    // Мастер сам описал волосы — их не задаём.
    await describeNpc(reply, arkham, { ...card, look: "рыжая, с косой" });
    expect(asked).not.toContain(st.hair!);
    // Мужчинам этих слоёв нет; профессия и возраст не меняют долю свободного ворота.
    expect(npcStyle(arkham, { name: "Том", gender: "m" }).under).toBeUndefined();
    const share = (role: string) => {
      const people = Array.from({ length: 900 }, (_, i) => npcStyle(arkham, { name: `Ж${i}`, gender: "f", role }));
      return people.filter((x) => x.under!.open).length / people.length;
    };
    expect(share("горничная")).toBeCloseTo(arkham.art.underlayersEn!.openShare, 1);
    expect(share("певица в баре")).toBeCloseTo(arkham.art.underlayersEn!.openShare, 1);
    const older = Array.from({ length: 900 }, (_, i) => npcStyle(arkham, { name: `В${i}`, gender: "f", role: "хозяйка пансиона" })).filter((x) => /fifties|sixties|elderly/.test(x.age!));
    expect(older.some((x) => x.under!.open)).toBe(true);
    // Скромные роли — всегда закрыто.
    for (let i = 0; i < 200; i++) expect(npcStyle(arkham, { name: `У${i}`, gender: "f", role: "учительница воскресной школы" }).under!.open).toBeUndefined();
    // Шрамы код не раздаёт: LoRA рисует их свежей раной.
    expect(Array.from({ length: 300 }, (_, i) => npcStyle(arkham, { name: `Ш${i}`, gender: "f" }).mark).some((m) => /scar/.test(m!))).toBe(false);
    // Пол угадывает модель — правила для обоих.
    await guessNpc(reply, arkham, { name: "Сэм", lines: ["Пришла!"], scene: "бар" });
    expect(asked).toMatch(/if a woman: age: [^;]+; hair in these words/);
    // Мир без причёсок и слоёв — без них.
    expect(npcStyle(world, { name: "x", gender: "f" }).under).toBeUndefined();
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
    expect(pa.prompt).toBe("mthnr style, waist-up portrait of a woman librarian, plain light grey background");
    calls.length = 0;
    await renderPortrait({ world, provider, storage, description: "a woman, female character, elf", key: "npc/f", seed: 1 });
    expect(calls[0]!.body.image_size).toEqual({ width: 1024, height: 1024 });
  });
});

describe("проверка портрета моделью со зрением", () => {
  const figure = (svg: string, w = 200, h = 300) =>
    sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${svg}</svg>`)).png().toBuffer();

  it("разбор ответа: лишние руки, подбородок, мусор", async () => {
    const { parseCheck } = await import("../src/index");
    expect(parseCheck('```json {"arms":2,"hands":3,"extra_limb":false,"chin":0.25,"note":"third hand"} ```')).toMatchObject({ limbs: true, chin: 0.25 });
    expect(parseCheck('{"arms":3,"hands":2,"extra_limb":false,"chin":0.3}')!.limbs).toBe(true);
    expect(parseCheck('{"arms":2,"hands":2,"extra_limb":true}')!.limbs).toBe(true);
    expect(parseCheck('{"arms":1,"hands":1,"extra_limb":false,"chin":0.31}')).toMatchObject({ limbs: false, chin: 0.31 });
    expect(parseCheck('{"arms":2,"hands":2,"chin":7}')!.chin).toBeUndefined();
    expect(parseCheck("не знаю")).toBeNull();
  });

  it("без VISION_MODEL проверки нет; с ней — картинка уходит модели", async () => {
    const { portraitInspector } = await import("../src/index");
    expect(portraitInspector(fakeRouter())).toBeUndefined();
    expect(portraitInspector(createRouter({ fake: true, models: { narratorPaid: "p", narratorFree: "f", utility: "u", vision: "v" } }))).toBeUndefined();
    let msg: any;
    const inspect = portraitInspector({ vision: () => ({ model: "v", provider: { name: "x", complete: async (r: any) => ((msg = r.messages[0]), { text: '{"arms":2,"hands":2,"extra_limb":false,"chin":0.3}', toolCalls: [], usage: { costUsd: 0.0001 }, model: "v", finishReason: "stop" }) } as any }) })!;
    const r = await inspect(await figure(`<rect x="50" y="20" width="100" height="280" fill="#800"/>`));
    expect(r).toMatchObject({ limbs: false, chin: 0.3, costUsd: 0.0001 });
    expect(msg.images[0]).toMatch(/^data:image\/jpeg;base64,/);
    const { toWireMessages } = await import("@ash/llm");
    expect((toWireMessages([msg])[0] as any).content[1].type).toBe("image_url");
  });

  it("размер головы: крупный кадр, мелкая фигура приближается", async () => {
    const { headFrame, finishPortrait, TOO_CLOSE } = await import("../src/process");
    const big = await headFrame(await figure(`<rect x="40" y="3" width="120" height="297" fill="#800"/>`), 0.5);
    expect(big!.tooClose).toBe(true);
    expect(big!.head).toBeGreaterThan(TOO_CLOSE);
    const small = await headFrame(await figure(`<rect x="120" y="60" width="40" height="240" fill="#800"/>`), 0.33);
    expect(small!.tooClose).toBe(false);
    expect(small!.zoom).toBeGreaterThan(1);
    expect(small!.cx).toBeCloseTo(0.7, 1);
    const ok = await headFrame(await figure(`<rect x="60" y="30" width="80" height="270" fill="#800"/>`), 0.35);
    expect(ok!.zoom).toBe(1);
    expect(await headFrame(await figure(`<rect x="60" y="30" width="80" height="270" fill="#800"/>`), 0.05)).toBeUndefined();
    // Приближённый портрет — того же размера, макушка ближе к верху, фигура шире.
    const src = await figure(`<rect x="120" y="60" width="40" height="240" fill="#800"/>`, 400, 600);
    const out = await finishPortrait(src, small!);
    const plain = await finishPortrait(src);
    expect([out.width, out.height]).toEqual([plain.width, plain.height]);
    const bbox = async (b: Buffer) => {
      const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let top = info.height, minX = info.width, maxX = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3]! > 128) { top = Math.min(top, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      return { top: top / info.height, width: (maxX - minX) / info.width };
    };
    const [z, p] = [await bbox(out.bytes), await bbox(plain.bytes)];
    expect(z.top).toBeLessThan(p.top);
    expect(z.width).toBeGreaterThan(p.width);
  });

  it("конвейер перерисовывает третью руку и крупный кадр, берёт лучший; без проверяющего — как раньше", async () => {
    const { renderPortrait } = await import("../src/index");
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), "ash-inspect-")));
    const seeds: number[] = [];
    const provider = new FakeImageProvider();
    const gen = provider.generate.bind(provider);
    provider.generate = (r: any) => (seeds.push(r.seed), gen(r));
    const answers = [
      { limbs: true, chin: 0.3, note: "third hand", costUsd: 0.001 },
      { limbs: false, chin: 0.3, note: "", costUsd: 0.001 },
    ];
    let k = 0;
    const r = await renderPortrait({ world, provider, storage, description: "a woman", key: "npc/i", seed: 5, inspect: async () => answers[k++] ?? null });
    expect(seeds).toEqual([5, 5 + 7919]);
    expect(r.redrawn).toBe(true);
    expect(r.issues).toEqual([]);
    // Все попытки с третьей рукой — после двух перерисовок сдаёмся и берём лучший.
    seeds.length = 0;
    const bad = await renderPortrait({ world, provider, storage, description: "a woman", key: "npc/j", seed: 1, inspect: async () => ({ limbs: true, note: "", costUsd: 0 }) });
    expect(seeds).toHaveLength(3);
    expect(bad.issues[0]).toMatch(/extra limbs/);
    // Пустой кадр (fal вернул чёрную картинку, вырезание съело всё) — перерисовка без вызова проверяющего.
    seeds.length = 0;
    let looked = 0;
    const blank = new FakeImageProvider();
    let first = true;
    blank.removeBackground = async (bytes: Buffer) => {
      if (first) {
        first = false;
        return { bytes: await sharp({ create: { width: 64, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), contentType: "image/png", model: "cut", costUsd: 0 };
      }
      return provider.removeBackground(bytes);
    };
    const bgen = blank.generate.bind(blank);
    blank.generate = (r: any) => (seeds.push(r.seed), bgen(r));
    const e = await renderPortrait({ world, provider: blank, storage, description: "a woman", key: "npc/e", seed: 3, inspect: async () => (looked++, { limbs: false, note: "", costUsd: 0 }) });
    expect(seeds).toEqual([3, 3 + 7919]);
    expect(looked).toBe(1);
    expect(e.issues).toEqual([]);
    // Без проверяющего — одна попытка на целый кадр.
    seeds.length = 0;
    await renderPortrait({ world, provider, storage, description: "a woman", key: "npc/k", seed: 1 });
    expect(seeds).toHaveLength(1);
  });
});

describe("варианты лица (эмоции)", () => {
  const arkham = getWorld("arkham");
  it("правка: тот же размер и прозрачный фон, что у портрета; лицо другое", async () => {
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), "ash-img-")));
    const provider = new FakeImageProvider();
    const base = await renderPortrait({ world: arkham, provider, storage, description: "a woman librarian, round glasses", key: "npc/base" });
    const v = await renderVariant({ world: arkham, provider, storage, baseUrl: base.url, look: "a woman librarian, round glasses", change: "frightened", key: "emo/v1", seed: 1 });
    expect(v.url).toBe("/api/images/emo/v1.webp");
    const a = await sharp((await storage.get(base.url))!).metadata();
    const b = await sharp((await storage.get(v.url))!).metadata();
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    expect(b.hasAlpha).toBe(true);
    expect(v.prompt).toContain("round glasses");
    expect(v.prompt).toContain("Change only the facial expression to frightened");
    expect((await storage.get(v.url))!.equals((await storage.get(base.url))!)).toBe(false);
  });
  it("без правки у провайдера или без файла портрета — ошибка, а не пустая картинка", async () => {
    const storage = new LocalStorage(await mkdtemp(join(tmpdir(), "ash-img-")));
    const bare = { name: "bare", generate: new FakeImageProvider().generate, removeBackground: new FakeImageProvider().removeBackground };
    await expect(renderVariant({ world: arkham, provider: bare, storage, baseUrl: "/api/images/npc/x.webp", look: "", change: "x", key: "emo/x", seed: 1 })).rejects.toThrow(/правк/);
    await expect(renderVariant({ world: arkham, provider: new FakeImageProvider(), storage, baseUrl: "/api/images/npc/none.webp", look: "", change: "x", key: "emo/x", seed: 1 })).rejects.toThrow(/нет файла/);
  });
  it("облик из промпта портрета: без триггера, кадра и фона", () => {
    const prompt = portraitPrompt(arkham, "a tall elderly man professor, pince-nez", true);
    expect(lookFromPrompt(arkham, prompt)).toBe("a tall elderly man professor, pince-nez");
    expect(lookFromPrompt(world, portraitPrompt(world, "dwarf smith, braided beard"))).toBe("dwarf smith, braided beard");
    expect(editPrompt(arkham, "x", "y")).toMatch(/^mthnr style, the same person/);
    expect(editPrompt(arkham, "x", "y")).toContain("glasses and every accessory");
  });
  it("fal: правка с LoRA, картинка data URI, размер кадра, цена за вход и выход", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#888" } }).png().toBuffer();
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ images: [{ url: `data:image/png;base64,${png.toString("base64")}` }] }));
    }) as unknown as typeof fetch;
    const p = new FalImageProvider({ key: "k", portraitModel: "m", backgroundModel: "m", cutoutModel: "fal-ai/birefnet/v2", editModel: DEFAULT_EDIT_MODEL, fetchImpl });
    const r = await p.edit({ image: png, prompt: "smile", width: 1024, height: 1536, seed: 5, lora: { url: "https://x/l.safetensors", scale: 1.2 } });
    expect(calls[0]!.url).toBe(`https://fal.run/${DEFAULT_EDIT_MODEL}`);
    expect(calls[0]!.body).toMatchObject({ prompt: "smile", sync_mode: true, image_size: { width: 1024, height: 1536 }, seed: 5, loras: [{ path: "https://x/l.safetensors", scale: 1.2 }] });
    expect(calls[0]!.body.image_urls[0]).toMatch(/^data:image\/png;base64,/);
    expect(r.costUsd).toBeCloseTo(0.02 * (1 + 1.572864), 4);
  });
});
