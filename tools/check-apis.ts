/**
 * Проверка доступа к внешним API с этой машины: pnpm check:apis
 * Флаг --images дополнительно генерирует по одной картинке (стоит несколько центов).
 */
import { configFromEnv, OpenRouterProvider } from "@ash/llm";

const env = process.env;
const withImages = process.argv.includes("--images");
let failed = 0;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => {
  failed++;
  console.log(`  ✗ ${m}`);
};

async function checkOpenRouter() {
  console.log("\nOpenRouter");
  const cfg = configFromEnv();
  if (!cfg.openRouterKey) return bad("OPENROUTER_API_KEY не задан");
  const headers = { Authorization: `Bearer ${cfg.openRouterKey}` };

  const key = await fetch("https://openrouter.ai/api/v1/key", { headers });
  if (!key.ok) return bad(`ключ не принят: HTTP ${key.status}`);
  const info: any = ((await key.json()) as any).data ?? {};
  ok(`ключ работает; потрачено $${Number(info.usage ?? 0).toFixed(2)}${info.limit != null ? ` из $${info.limit}` : ""}`);

  const models: any = await fetch("https://openrouter.ai/api/v1/models").then((r) => r.json());
  const ids = new Set<string>((models.data ?? []).map((m: any) => m.id));
  const provider = new OpenRouterProvider({ apiKey: cfg.openRouterKey });
  for (const [role, id] of Object.entries(cfg.models)) {
    if (!ids.has(id)) {
      const similar = [...ids].filter((x) => x.includes(id.split("/")[1]?.split("-").slice(0, 2).join("-") ?? "")).slice(0, 5);
      bad(`${role}: модели «${id}» нет в каталоге${similar.length ? `; похожие: ${similar.join(", ")}` : ""}`);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await provider.complete({ model: id, maxTokens: 30, messages: [{ role: "user", content: "Ответь одним словом по-русски: какого цвета пепел?" }] });
      ok(`${role}: ${id} → «${r.text.trim().slice(0, 40)}» за ${Date.now() - t0} мс, $${r.usage.costUsd.toFixed(5)}`);
    } catch (e) {
      bad(`${role}: ${id} → ${(e as Error).message}`);
    }
  }
}

async function falRun(model: string, input: Record<string, unknown>) {
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: any = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function checkFal() {
  console.log("\nfal.ai (FLUX)");
  if (!env.FAL_KEY) return bad("FAL_KEY не задан");
  const models = {
    background: env.FAL_BACKGROUND_MODEL || "fal-ai/flux-2/klein/4b",
    portrait: env.FAL_PORTRAIT_MODEL || "fal-ai/flux-pro/kontext/text-to-image",
    cutout: env.FAL_CUTOUT_MODEL || "fal-ai/birefnet/v2",
  };
  if (!withImages) {
    // Пустой запрос: 422 значит, что ключ и модель приняты, а не хватает только промпта.
    for (const [role, id] of Object.entries(models)) {
      const r = await falRun(id, {});
      if (r.body?.type === "endpoint_not_priced") bad(`${role}: «${id}» — неверный id модели, проверь на fal.ai/models`);
      else if (r.status === 401 || r.status === 403) bad(`${role}: ключ не принят (HTTP ${r.status})`);
      else if (r.status === 404) bad(`${role}: модели «${id}» нет — проверь id на fal.ai/models`);
      else ok(`${role}: ${id} доступна (HTTP ${r.status}; для пробной картинки запусти с --images)`);
    }
    return;
  }
  for (const [role, id] of Object.entries(models)) {
    if (role === "cutout") continue; // вырезанию нужен вход-картинка — проверяется в игре
    const t0 = Date.now();
    const r = await falRun(id, { prompt: "dark fantasy painterly illustration, abandoned village at dusk, drifting grey ash", num_images: 1 });
    const url = r.body?.images?.[0]?.url;
    if (url) ok(`${role}: ${id} → ${url} за ${Date.now() - t0} мс`);
    else bad(`${role}: ${id} → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
}

console.log("Проверка внешних API");
await checkOpenRouter().catch((e) => bad(`OpenRouter: ${e.message}`));
await checkFal().catch((e) => bad(`fal.ai: ${e.message}`));
console.log(failed ? `\nПроблем: ${failed}` : "\nВсё доступно.");
process.exit(failed ? 1 : 0);
