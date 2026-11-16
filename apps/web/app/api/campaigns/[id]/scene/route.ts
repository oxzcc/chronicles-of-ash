import { loadCampaign, sceneView } from "@ash/game";
import { currentUser, errorResponse, getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Картинки сцены — клиент опрашивает, пока что-то рисуется. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    const c = await loadCampaign(getDb(), user.id, id, 0);
    return Response.json(await sceneView(getDb(), c.id, c.characterId, c.state.campaign));
  } catch (e) {
    return errorResponse(e);
  }
}
