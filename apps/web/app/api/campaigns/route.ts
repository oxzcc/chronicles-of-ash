import type { CharacterDraft } from "@ash/engine";
import { secureRng } from "@ash/engine";
import { createCampaign, listCampaigns, newGame } from "@ash/game";
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
    const { draft } = (await req.json()) as { draft: CharacterDraft };
    const g = await newGame({ router: getRouter(), tier: user.tier, draft, rng: secureRng, seed: crypto.randomUUID(), signal: req.signal });
    const id = await createCampaign(getDb(), user.id, g);
    return Response.json({ id, usedFallback: g.usedFallback, costUsd: g.usage.costUsd });
  } catch (e) {
    return errorResponse(e);
  }
}
