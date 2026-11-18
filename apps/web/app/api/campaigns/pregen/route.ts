import { validateDraft, type CharacterDraft } from "@ash/engine";
import { draftWorld } from "@ash/game";
import { currentUser, errorResponse, getPregen } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Ранний старт: начать придумывать дело, пока игрок выбирает портрет или пишет предысторию.
 * Отвечает сразу; дело придумывается в фоне и ждёт старта (см. PregenStore).
 * Неполный герой — не ошибка: просто не начинаем.
 */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    const { draft } = (await req.json()) as { draft: CharacterDraft };
    if (validateDraft(draftWorld(draft).rules, draft).length) return Response.json({ status: "incomplete" });
    return Response.json({ status: getPregen().begin(user.id, draft, user.tier) });
  } catch (e) {
    return errorResponse(e);
  }
}
