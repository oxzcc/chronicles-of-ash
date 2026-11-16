import {
  applyChanges, CLASSES, combatSummary, knockOut, locationById, playerMove, skillCheck, startCombat, travel,
  type CombatEvent, type CombatOutcome,
} from "@ash/engine";
import { emptyUsage, runNarratorTurn, systemActions, type HistoryEntry } from "@ash/llm";
import { GameError, type GameState, type TurnDeps, type TurnInput, type TurnOutcome, type TurnRecord } from "./types";
import { toHistory, type Recordish } from "./history";

export const MAX_ACTION_LENGTH = 500;

const MOVE_LABELS = { attack: "Атака", ability: "Умение", potion: "Зелье", dodge: "Защита", flee: "Бегство" } as const;

/**
 * Один ход игры: проверяет, можно ли его сделать, зовёт рассказчика, применяет изменения движком.
 * Состояние меняется на месте — вызывающий сохраняет его вместе с записями.
 * `prior` — уже сохранённые записи журнала (для промпта).
 */
export async function playTurn(deps: TurnDeps, state: GameState, prior: Recordish[], input: TurnInput): Promise<TurnOutcome> {
  const { character: c, campaign: w } = state;
  const records: TurnRecord[] = [];
  const history = (): HistoryEntry[] => toHistory([...prior, ...records]);

  /** Ход рассказчика: промпт, проверки, применение изменений, бой, если модель его объявила. */
  const narrate = async (kind: TurnRecord["kind"], label: string, action: string, opts: { keepHp?: boolean; preRolls?: TurnRecord["rolls"] } = {}) => {
    const { provider, model } = deps.router.route("narrator", deps.tier);
    const r = await runNarratorTurn({
      provider, model, worldBible: deps.worldBible, rng: deps.rng, signal: deps.signal,
      scene: { character: c, campaign: w, history: history(), action },
      onBeats: (beats) => deps.emit?.({ type: "beats", beats }),
      onRoll: (roll) => deps.emit?.({ type: "roll", roll }),
      onSpeaker: deps.onSpeaker,
      allowChecks: !opts.preRolls?.length,
    });
    const resp = r.response;
    const applied = applyChanges(c, w, {
      ...resp.changes,
      hp: opts.keepHp ? 0 : resp.changes.hp,
      questDone: resp.questDone,
      questComplete: resp.questComplete,
    });
    w.npc = resp.speaker;
    w.turn++;
    records.push({
      kind, action: label, narration: resp.narration, beats: resp.beats, speaker: resp.speaker?.name ?? null, line: "",
      suggestions: resp.suggestions, response: resp, applied, rolls: [...(opts.preRolls ?? []), ...r.rolls], combatEvents: [],
      model: r.model, promptVersion: r.promptVersion, usage: r.usage, degraded: r.degraded,
      ...(r.degraded ? { raw: r.rawText.slice(0, 8000) } : {}),
    });
    return { resp, applied };
  };

  const combatRecord = (label: string, events: CombatEvent[], outcome: CombatOutcome) => {
    deps.emit?.({ type: "combat", events, combat: w.combat, outcome });
    records.push({
      kind: "combat", action: label, narration: events.map((e) => e.text).join(" "), beats: [], speaker: null, line: "",
      suggestions: [], response: null, applied: null, rolls: [], combatEvents: events,
      model: "engine", promptVersion: "-", usage: emptyUsage(), degraded: false,
    });
  };

  /** Итог боя: победа, бегство или поражение → рассказ мастера и выход из боя. */
  const finishCombat = async (outcome: CombatOutcome) => {
    if (outcome === "ongoing" || !w.combat) return;
    const foes = combatSummary(w.combat);
    const tail = w.combat.log.slice(-3).map((e) => e.text).join(" ");
    w.combat = null;
    if (outcome === "victory") await narrate("combat", "Бой окончен победой", systemActions.victory(foes, tail));
    else if (outcome === "fled") await narrate("combat", "Герой бежал с поля боя", systemActions.fled(foes));
    else await knockedOut(foes);
  };

  const knockedOut = async (foes?: string) => {
    const { goldLost } = knockOut(c);
    await narrate("knockout", "Герой потерял сознание", systemActions.knockedOut(goldLost, foes), { keepHp: true });
  };

  /** Если ответ мастера объявил бой — начинаем его; враги могут ударить первыми. */
  const maybeStartCombat = async (resp: { combat: { enemies: unknown[] } | null }) => {
    if (!resp.combat || w.combat) return;
    const start = startCombat(c, resp.combat.enemies as any[], deps.rng);
    w.combat = start.state;
    combatRecord("Начало боя", start.events, start.outcome);
    await finishCombat(start.outcome);
  };

  /** Здоровье упало до нуля вне боя (ловушка, падение) — тоже поражение. */
  const checkDowned = async () => {
    if (c.hp <= 0 && !w.combat) await knockedOut();
  };

  switch (input.kind) {
    case "start": {
      if (w.turn > 0) throw new GameError("Приключение уже началось.");
      const place = locationById(w, w.current)!;
      const { resp } = await narrate("start", "Начало приключения", systemActions.start(place.name));
      await maybeStartCombat(resp);
      break;
    }
    case "action": {
      if (w.combat) throw new GameError("Идёт бой — выбери действие в бою.");
      const text = input.text.trim().slice(0, MAX_ACTION_LENGTH);
      if (!text) throw new GameError("Напиши, что делает герой.");
      const { resp } = await narrate("action", text, text);
      await maybeStartCombat(resp);
      await checkDowned();
      break;
    }
    case "choice": {
      if (w.combat) throw new GameError("Идёт бой — выбери действие в бою.");
      // Варианты — из последнего ответа мастера, где они были (клиент показывает те же).
      const last = [...prior, ...records].reverse().find((r) => r.suggestions?.length);
      const pick = last?.suggestions?.[input.index];
      if (!pick) throw new GameError("Этот вариант уже неактуален.");
      let action = pick.text;
      const preRolls: TurnRecord["rolls"] = [];
      if (pick.check) {
        const roll = skillCheck(c, { skill: pick.check.skill, dc: pick.check.dc }, deps.rng);
        deps.emit?.({ type: "roll", roll });
        preRolls.push(roll);
        action = systemActions.checked(pick.text, roll.summary);
      }
      const { resp } = await narrate("choice", pick.text, action, { preRolls });
      await maybeStartCombat(resp);
      await checkDowned();
      break;
    }
    case "travel": {
      let t;
      try {
        t = travel(w, input.to, deps.rng);
      } catch (e) {
        throw new GameError((e as Error).message);
      }
      const { resp } = await narrate("travel", `Путь в «${t.to.name}»`, systemActions.travel(t.from.name, t.to.name, t.encounter));
      await maybeStartCombat(resp);
      await checkDowned();
      break;
    }
    case "rest": {
      if (w.combat) throw new GameError("Посреди боя не отдохнуть.");
      const missing = c.hpMax - c.hp;
      const { resp, applied } = await narrate("rest", "Привал", systemActions.rest(missing));
      // Отдых удался, если мастер вернул здоровье (или его и так хватало) и не начался бой.
      if (!resp.combat && (applied.hp > 0 || missing === 0)) c.abilityUses = CLASSES[c.cls].ability.uses;
      await maybeStartCombat(resp);
      break;
    }
    case "combat": {
      if (!w.combat) throw new GameError("Сейчас нет боя.");
      let step;
      try {
        step = playerMove(w.combat, c, input.move, deps.rng, input.target);
      } catch (e) {
        throw new GameError((e as Error).message);
      }
      combatRecord(MOVE_LABELS[input.move], step.events, step.outcome);
      await finishCombat(step.outcome);
      break;
    }
  }
  return { state, records };
}
