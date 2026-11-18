import { backgroundStatus, loadCampaign, sceneView } from "@ash/game";
import { currentUser, errorResponse, getDb } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Картинки сцены — клиент опрашивает, пока что-то рисуется.
 * `?loc=&bg=` — фон локации, в которую герой входит прямо сейчас (ход ещё не сохранён).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    const c = await loadCampaign(getDb(), user.id, id, 0);
    const scene = await sceneView(getDb(), c.id, c.characterId, c.state.campaign);
    const q = new URL(req.url).searchParams;
    const loc = q.get("loc");
    const bg = q.get("bg");
    if (loc && bg && !scene.locations[loc] && c.state.campaign.locations.some((l) => l.id === loc)) {
      const img = await backgroundStatus(getDb(), c.id, bg);
      if (img) scene.locations[loc] = img;
    }
    return Response.json(scene);
  } catch (e) {
    return errorResponse(e);
  }
}
