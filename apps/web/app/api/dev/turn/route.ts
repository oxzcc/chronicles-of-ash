import {
  applyChanges, createCharacter, layoutCampaign, RECOMMENDED_STATS, secureRng, startCombat,
} from "@ash/engine";
import { runNarratorTurn } from "@ash/llm";
import { getRouter, getWorldBible, sseStream } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Временная ручка разработки: один ход на тестовом герое без базы.
 * Проверяет всю цепочку — промпт, roll_check, стриминг, применение изменений.
 * Удалится, когда появится настоящий игровой цикл (фаза 1).
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { action = "Осматриваюсь", tier = "free" } = (await req.json().catch(() => ({}))) as { action?: string; tier?: "free" | "paid" };

  const character = createCharacter(
    { name: "Альдрик", gender: "m", race: "human", cls: "fighter", base: { ...RECOMMENDED_STATS.fighter }, skills: ["Внимательность", "Убеждение"], backstory: "Бывший стражник, ищет пропавшую сестру." },
    secureRng,
  );
  const campaign = layoutCampaign({
    questTitle: "Пепел над Чернолесьем",
    hook: "В деревне Вересковый Брод пропадают люди, а над Чернолесьем по ночам поднимается пепельный дым.",
    objectives: ["Расспросить жителей Брода о пропавших", "Найти источник пепельного дыма", "Остановить похитителя"],
    locations: [
      { name: "Вересковый Брод", type: "village", desc: "Деревня у реки, где по ночам запирают ставни." },
      { name: "Таверна «Хромой гусь»", type: "tavern", desc: "Шумная корчма у переправы." },
      { name: "Королевский тракт", type: "road", desc: "Старая дорога без патрулей." },
      { name: "Чернолесье", type: "forest", desc: "Ельник, где тропы меняются местами." },
      { name: "Руины Дозорной башни", type: "ruins", desc: "Обломки башни прошлой войны." },
      { name: "Пепельная пещера", type: "cave", desc: "Из расщелины тянет дымом." },
    ],
    target: 5,
  }, String(Date.now()));

  const { provider, model } = getRouter().route("narrator", tier);
  return sseStream(async (send) => {
    const r = await runNarratorTurn({
      provider, model, worldBible: getWorldBible(), rng: secureRng, signal: req.signal,
      scene: { character, campaign, history: [], action: String(action).slice(0, 500) },
      onNarration: (text) => send("narration", { text }),
      onRoll: (roll) => send("roll", roll),
    });
    const applied = applyChanges(character, campaign, { ...r.response.changes, questDone: r.response.questDone, questComplete: r.response.questComplete });
    const combat = r.response.combat ? startCombat(character, r.response.combat.enemies, secureRng) : null;
    send("done", { response: r.response, applied, combat, usage: r.usage, model: r.model, requests: r.requests, degraded: r.degraded });
  });
}
