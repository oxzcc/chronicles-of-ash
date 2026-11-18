import type { CharacterDraft } from "@ash/engine";
import { createHeroOptions, imageStatuses } from "@ash/game";
import { currentUser, errorResponse, getDb, getRouter } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Четыре варианта облика героя — в очередь; клиент опрашивает GET. */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    const { draft, notes } = (await req.json()) as { draft: CharacterDraft; notes?: string };
    const options = await createHeroOptions(getDb(), getRouter(), user.id, draft, String(notes ?? "").slice(0, 300), req.signal);
    return Response.json({ options });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  try {
    const user = await currentUser();
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",");
    return Response.json({ images: await imageStatuses(getDb(), user.id, ids) });
  } catch (e) {
    return errorResponse(e);
  }
}
