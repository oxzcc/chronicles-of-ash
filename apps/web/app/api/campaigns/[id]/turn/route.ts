import { secureRng, type CombatMove } from "@ash/engine";
import { arrivalView, ensureBackground, ensureNpc, GameError, loadCampaign, playTurn, prepareVisuals, saveTurn, sceneView, type TurnInput } from "@ash/game";
import { currentUser, errorResponse, getDb, getRouter, getWorldBible, sseStream, withCampaignLock } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MOVES: CombatMove[] = ["attack", "ability", "potion", "dodge", "flee"];

/** Вход от клиента проверяется здесь: клиенту не доверяем ничего, кроме намерения. */
function parseInput(body: any): TurnInput {
  switch (body?.kind) {
    case "start":
    case "rest":
      return { kind: body.kind };
    case "action":
      return { kind: "action", text: String(body.text ?? "") };
    case "travel":
      return { kind: "travel", to: String(body.to ?? "") };
    case "choice":
      if (!Number.isInteger(body.index) || body.index < 0 || body.index > 5) throw new GameError("Неизвестный вариант.");
      return { kind: "choice", index: body.index };
    case "combat":
      if (!MOVES.includes(body.move)) throw new GameError("Неизвестное действие в бою.");
      return { kind: "combat", move: body.move, target: Number.isInteger(body.target) ? body.target : undefined };
    default:
      throw new GameError("Неизвестный тип хода.");
  }
}

/**
 * Ход по SSE: beats (реплики по мере генерации), roll (бросок), combat (раунд боя),
 * done (новое состояние и записи журнала) или error.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let input: TurnInput;
  let userId: string;
  let tier: "free" | "paid";
  const { id } = await params;
  try {
    input = parseInput(await req.json());
    ({ id: userId, tier } = await currentUser());
  } catch (e) {
    return errorResponse(e);
  }
  return sseStream((send) =>
    withCampaignLock(id, async () => {
      const db = getDb();
      const c = await loadCampaign(db, userId, id);
      const out = await playTurn(
        {
          router: getRouter(), tier, worldBible: getWorldBible(), rng: secureRng, signal: req.signal, emit: (e) => send(e.type, e),
          // Портрет нового NPC начинает рисоваться, пока мастер ещё дописывает ход.
          onSpeaker: (s) => void ensureNpc(db, c.id, s).catch((e) => console.error("[images] early npc", e)),
          // Фон новой локации — в очередь до рассказа; клиент показывает его, как только он готов.
          onArrive: async () => {
            try {
              await ensureBackground(db, c.id, c.state.campaign);
              send("arrive", await arrivalView(db, c.state.campaign));
            } catch (e) {
              console.error("[images] arrive", e);
            }
          },
        },
        c.state, c.recent, input,
      );
      // Картинки — в очередь до сохранения: фон локации записывается в состояние кампании.
      await prepareVisuals(db, c.id, out.state, out.records).catch((e) => console.error("[images] prepare", e));
      const turnNo = await saveTurn(db, c, out.state, out.records);
      send("done", {
        turnNo, character: out.state.character, campaign: out.state.campaign,
        turns: out.records.map((r, i) => ({
          turnNo: c.turnNo + i + 1, kind: r.kind, action: r.action, narration: r.narration, beats: r.beats, speaker: r.speaker, line: r.line,
          rolls: r.rolls, suggestions: r.suggestions, combatEvents: r.combatEvents,
        })),
        costUsd: out.records.reduce((s, r) => s + r.usage.costUsd, 0),
        scene: await sceneView(db, c.id, c.characterId, out.state.campaign),
      });
    }),
  );
}
