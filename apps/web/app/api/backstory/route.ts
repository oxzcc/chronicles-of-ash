import type { CharacterDraft } from "@ash/engine";
import { generateBackstory } from "@ash/game";
import { currentUser, errorResponse, getRouter } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await currentUser();
    const { draft } = (await req.json()) as { draft: CharacterDraft };
    const r = await generateBackstory({ router: getRouter(), draft, signal: req.signal });
    return Response.json({ text: r.text });
  } catch (e) {
    return errorResponse(e);
  }
}
