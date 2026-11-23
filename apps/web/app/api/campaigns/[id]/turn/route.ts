import { publicCampaign, secureRng, type CombatMove } from "@ash/engine";
import { arrivalView, ensureBackground, ensureEmotion, ensureNpc, GameError, loadCampaign, playTurn, prepareVisuals, saveTurn, sceneView, type TurnInput } from "@ash/game";
import { worldOf } from "@ash/worlds";
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
    case "lookup":
      return { kind: "lookup", query: String(body.query ?? "") };
    case "reconstruct":
      return { kind: "reconstruct", text: String(body.text ?? "") };
    case "present":
      return { kind: "present", clue: String(body.clue ?? "").slice(0, 8), text: typeof body.text === "string" ? body.text.slice(0, 300) : undefined };
    case "close": {
      const raw = body.answers && typeof body.answers === "object" ? body.answers : {};
      const answers = Object.fromEntries(Object.entries(raw).slice(0, 6).map(([k, v]) => [String(k).slice(0, 8), String(v ?? "")]));
      return { kind: "close", answers };
    }
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
      const world = worldOf(c.state.character);
      const out = await playTurn(
        {
          router: getRouter(), tier, worldBible: getWorldBible(world), rng: secureRng, signal: req.signal, emit: (e) => send(e.type, e),
          // Портрет нового NPC начинает рисоваться, пока мастер ещё дописывает ход.
          onSpeaker: (s) => void ensureNpc(db, c.id, world, s).catch((e) => console.error("[images] early npc", e)),
          // Лицо с эмоцией — тоже пока мастер пишет; для нового NPC (портрета ещё нет) — после хода.
          onEmotion: (name, emotion) => void ensureEmotion(db, c.id, world, name, emotion).catch((e) => console.error("[images] early emotion", e)),
          // Фон новой локации — в очередь до рассказа; клиент показывает его, как только он готов.
          onArrive: async () => {
            try {
              await ensureBackground(db, c.id, world, c.state.campaign);
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
        // Клиенту — без разгадки, ответов и ненайденных улик.
        turnNo, character: out.state.character, campaign: publicCampaign(out.state.campaign),
        turns: out.records.map((r, i) => ({
          turnNo: c.turnNo + i + 1, kind: r.kind, action: r.action, narration: r.narration, beats: r.beats, speaker: r.speaker, line: r.line,
          rolls: r.rolls, suggestions: r.suggestions, combatEvents: r.combatEvents, effects: r.applied?.effects ?? [],
        })),
        costUsd: out.records.reduce((s, r) => s + r.usage.costUsd, 0),
        scene: await sceneView(db, c.id, c.characterId, out.state.campaign),
      });
    }),
  );
}
