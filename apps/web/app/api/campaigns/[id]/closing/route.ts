import { GameError, loadCampaign, prepareCaseClosing, saveTurn } from "@ash/game";
import { worldOf } from "@ash/worlds";
import { currentUser, errorResponse, getDb, withCampaignLock } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Подготовить кабинет и задумчивый портрет для отдельной сцены закрытия дела. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    return Response.json(
      await withCampaignLock(id, async () => {
        const db = getDb();
        const c = await loadCampaign(db, user.id, id, 0);
        if (!c.state.campaign.case) throw new GameError("В этом мире нет дел.");
        if (c.state.campaign.case.result) throw new GameError("Дело уже закрыто.");
        const result = await prepareCaseClosing(db, c.id, c.characterId, worldOf(c.state.character), c.state.campaign);
        // ensureBackground мог записать imageId в кабинет; сохраняем без нового хода и с той же optimistic lock.
        await saveTurn(db, c, c.state, []);
        return result;
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
