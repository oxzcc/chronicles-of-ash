import { publicCampaign } from "@ash/engine";
import { campaignCost, campaignTurns, loadCampaign, sceneView } from "@ash/game";
import { currentUser, errorResponse, getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    const c = await loadCampaign(getDb(), user.id, id, 0);
    // Клиенту — без разгадки, ответов и ненайденных улик.
    return Response.json({ id: c.id, turnNo: c.turnNo, character: c.state.character, campaign: publicCampaign(c.state.campaign), turns: await campaignTurns(getDb(), id), costUsd: await campaignCost(getDb(), id), scene: await sceneView(getDb(), c.id, c.characterId, c.state.campaign) });
  } catch (e) {
    return errorResponse(e);
  }
}
