import { campaignCost, campaignTurns, loadCampaign, sceneView } from "@ash/game";
import { currentUser, errorResponse, getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    const c = await loadCampaign(getDb(), user.id, id, 0);
    return Response.json({ id: c.id, turnNo: c.turnNo, ...c.state, turns: await campaignTurns(getDb(), id), costUsd: await campaignCost(getDb(), id), scene: await sceneView(getDb(), c.id, c.characterId, c.state.campaign) });
  } catch (e) {
    return errorResponse(e);
  }
}
