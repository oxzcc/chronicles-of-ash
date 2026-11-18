import type { CharacterDraft } from "@ash/engine";
import { secureRng } from "@ash/engine";
import { attachHeroPortrait, createCampaign, listCampaigns, loadCampaign, newGame, prefetchVisuals, saveFreshState, type GenProgress } from "@ash/game";
import { worldOf } from "@ash/worlds";
import { currentUser, errorResponse, getDb, getPregen, getRouter, sseStream } from "@/lib/server";

export const dynamic = "force-dynamic";
// Дело рассказчик придумывает до минуты (две попытки — до двух).
export const maxDuration = 180;

export async function GET() {
  try {
    const user = await currentUser();
    return Response.json({ campaigns: await listCampaigns(getDb(), user.id), llm: getRouter().isFake ? "fake" : "live" });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Новый герой + кампания: квест придумывает рассказчик тарифа игрока.
 * Если дело для этого же героя уже придумывается заранее (ранний старт, /api/campaigns/pregen),
 * берём его — полоса продолжается с того места, где оно сейчас.
 * С заголовком Accept: text/event-stream ответ идёт потоком: события progress (полоса загрузки),
 * затем done с id кампании или error. Без него — один JSON, как раньше.
 */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    const { draft, portraitId } = (await req.json()) as { draft: CharacterDraft; portraitId?: string };
    const fresh = (onProgress?: (p: GenProgress) => void) =>
      newGame({ router: getRouter(), tier: user.tier, draft, rng: secureRng, seed: crypto.randomUUID(), signal: req.signal, onProgress });
    const create = async (onProgress?: (p: GenProgress) => void) => {
      const pending = getPregen().take(user.id, draft, user.tier);
      let g: Awaited<ReturnType<typeof fresh>> | null = null;
      if (pending) {
        if (pending.progress && onProgress) onProgress(pending.progress);
        const off = onProgress ? pending.subscribe(onProgress) : () => {};
        // Заготовка сорвалась (сеть, отмена) — придумываем заново, игроку это не ошибка.
        g = await pending.result.catch(() => null).finally(off);
      }
      g ??= await fresh(onProgress);
      const id = await createCampaign(getDb(), user.id, g);
      // Картинки про запас — пока рассказчик пишет завязку: фон старта, фоны известных мест, портреты жителей дела.
      try {
        if (await prefetchVisuals(getDb(), id, worldOf(g.character), g.campaign)) await saveFreshState(getDb(), id, g.campaign);
      } catch (e) {
        console.error("[images] prefetch", e);
      }
      if (portraitId) {
        // Портрет не обязателен: если с ним что-то не так, герой просто начнёт без него.
        const c = await loadCampaign(getDb(), user.id, id, 0);
        await attachHeroPortrait(getDb(), user.id, c.characterId, portraitId).catch(() => undefined);
      }
      return { id, usedFallback: g.usedFallback, costUsd: g.usage.costUsd, early: !!pending };
    };
    if (!req.headers.get("accept")?.includes("text/event-stream")) return Response.json(await create());
    return sseStream(async (send) => {
      const r = await create((p) => send("progress", p));
      send("done", r);
    });
  } catch (e) {
    return errorResponse(e);
  }
}
