import type { CharacterDraft } from "@ash/engine";
import { secureRng } from "@ash/engine";
import { attachHeroPortrait, createCampaign, listCampaigns, loadCampaign, newGame } from "@ash/game";
import { currentUser, errorResponse, getDb, getRouter, sseStream } from "@/lib/server";

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
 * С заголовком Accept: text/event-stream ответ идёт потоком: события progress (полоса загрузки),
 * затем done с id кампании или error. Без него — один JSON, как раньше.
 */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    const { draft, portraitId } = (await req.json()) as { draft: CharacterDraft; portraitId?: string };
    const create = async (onProgress?: Parameters<typeof newGame>[0]["onProgress"]) => {
      const g = await newGame({ router: getRouter(), tier: user.tier, draft, rng: secureRng, seed: crypto.randomUUID(), signal: req.signal, onProgress });
      const id = await createCampaign(getDb(), user.id, g);
      if (portraitId) {
        // Портрет не обязателен: если с ним что-то не так, герой просто начнёт без него.
        const c = await loadCampaign(getDb(), user.id, id, 0);
        await attachHeroPortrait(getDb(), user.id, c.characterId, portraitId).catch(() => undefined);
      }
      return { id, usedFallback: g.usedFallback, costUsd: g.usage.costUsd };
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
