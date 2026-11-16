import type { CharacterDraft } from "@ash/engine";
import { secureRng } from "@ash/engine";
import { attachHeroPortrait, createCampaign, listCampaigns, loadCampaign, newGame } from "@ash/game";
import { currentUser, errorResponse, getDb, getRouter } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await currentUser();
    return Response.json({ campaigns: await listCampaigns(getDb(), user.id), llm: getRouter().isFake ? "fake" : "live" });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Новый герой + кампания: квест придумывает рассказчик тарифа игрока. */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    const { draft, portraitId } = (await req.json()) as { draft: CharacterDraft; portraitId?: string };
    const g = await newGame({ router: getRouter(), tier: user.tier, draft, rng: secureRng, seed: crypto.randomUUID(), signal: req.signal });
    const id = await createCampaign(getDb(), user.id, g);
    if (portraitId) {
      // Портрет не обязателен: если с ним что-то не так, герой просто начнёт без него.
      const c = await loadCampaign(getDb(), user.id, id, 0);
      await attachHeroPortrait(getDb(), user.id, c.characterId, portraitId).catch(() => undefined);
    }
    return Response.json({ id, usedFallback: g.usedFallback, costUsd: g.usage.costUsd });
  } catch (e) {
    return errorResponse(e);
  }
}
