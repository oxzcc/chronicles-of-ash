import {
  applyCaseChanges, applyChanges, breakDown, effect, emptyApplied, CASE_LIMITS, closeCase, combatSummary, isUnhinged, deductionCandidates, knockOut, locationById, lookup, markDeduction,
  playerMove, skillCheck, startCombat, storyMove, travel, travelCase,
  type CombatEvent, type CombatOutcome, type TurnEffect, type Verdict,
} from "@ash/engine";
import {
  addUsage, caseActions, deducePrompt, emptyUsage, gradePrompt, parseDeduction, parseVerdicts, roughVerdict, runNarratorTurn, systemActions,
  type HistoryEntry, type Usage,
} from "@ash/llm";
import { worldOf } from "@ash/worlds";
import { GameError, type GameState, type TurnDeps, type TurnInput, type TurnOutcome, type TurnRecord } from "./types";
import { toHistory, type Recordish } from "./history";
import { resolveMarks, tagLast } from "./marks";

export const MAX_ACTION_LENGTH = 500;
export const MAX_ANSWER_LENGTH = 400;

const MOVE_LABELS = { attack: "Атака", ability: "Умение", dodge: "Защита", flee: "Бегство" } as const;

/**
 * Один ход игры: проверяет, можно ли его сделать, зовёт рассказчика, применяет изменения движком.
 * Состояние меняется на месте — вызывающий сохраняет его вместе с записями.
 * `prior` — уже сохранённые записи журнала (для промпта).
 */
export async function playTurn(deps: TurnDeps, state: GameState, prior: Recordish[], input: TurnInput): Promise<TurnOutcome> {
  const { character: c, campaign: w } = state;
  const world = worldOf(c);
  const R = world.rules;
  const records: TurnRecord[] = [];
  const history = (): HistoryEntry[] => toHistory([...prior, ...records]);

  /** Ход рассказчика: промпт, проверки, применение изменений, бой, если модель его объявила. */
  const narrate = async (kind: TurnRecord["kind"], label: string, action: string, opts: { keepHp?: boolean; keepSanity?: boolean; preRolls?: TurnRecord["rolls"]; extraUsage?: Usage; allowMove?: boolean } = {}) => {
    const { provider, model } = deps.router.route("narrator", deps.tier);
    const r = await runNarratorTurn({
      provider, model, world, worldBible: deps.worldBible, rng: deps.rng, signal: deps.signal,
      scene: { character: c, campaign: w, history: history(), action },
      onBeats: (beats) => deps.emit?.({ type: "beats", beats }),
      onRoll: (roll) => deps.emit?.({ type: "roll", roll }),
      onSpeaker: deps.onSpeaker,
      allowChecks: !opts.preRolls?.length,
    });
    const resp = r.response;
    const applied = applyChanges(R, c, w, {
      ...resp.changes,
      hp: opts.keepHp ? 0 : resp.changes.hp,
      sanity: opts.keepSanity ? 0 : resp.changes.sanity,
      questDone: resp.questDone,
      // Дело закрывает игрок, а не мастер.
      questComplete: w.case ? false : resp.questComplete,
    });
    if (w.case) {
      const found = applyCaseChanges(w, { clues: resp.clues, reveal: resp.reveal });
      applied.notes.push(...found.notes);
      applied.effects.push(...found.effects);
      applied.rejected.push(...found.rejected);
      if (applied.sanity < 0) w.case.sanityLost += -applied.sanity;
    }
    // Мастер довёл героя до другого места прямо в рассказе — движок проверяет и переносит (после reveal: адрес мог открыться в этом же ответе).
    if (opts.allowMove) {
      const m = storyMove(R, w, resp.move, deps.rng);
      if (m && "error" in m) applied.rejected.push(m.error);
      else if (m) {
        applied.notes.push(`переход: ${m.to.name}${m.timeUp ? " (визиты кончились)" : ""}`);
        await deps.onArrive?.();
      }
    }
    // Подсветка находок в тексте — только принятых движком; «предъявить» — только найденную улику.
    resp.beats = resolveMarks(resp.beats, applied.effects);
    resp.suggestions = resp.suggestions.map((s) => {
      if (!s.present) return s;
      const clue = w.case?.clues.find((x) => x.id === s.present && x.found && !x.requires);
      if (clue) return s;
      const { present: _drop, ...rest } = s;
      return rest;
    });
    w.npc = resp.speaker;
    w.turn++;
    records.push({
      kind, action: label, narration: resp.narration, beats: resp.beats, speaker: resp.speaker?.name ?? null, line: "",
      // На грани безумия мысли путаются: вариантов меньше (как в Call of Cthulhu).
      suggestions: isUnhinged(c) ? resp.suggestions.slice(0, 2) : resp.suggestions, response: resp, applied, rolls: [...(opts.preRolls ?? []), ...r.rolls], combatEvents: [],
      model: r.model, promptVersion: r.promptVersion, usage: opts.extraUsage ? addUsage(r.usage, opts.extraUsage) : r.usage, degraded: r.degraded,
      ...(r.degraded ? { raw: r.rawText.slice(0, 8000) } : {}),
    });
    return { resp, applied };
  };

  /** Запись без модели (справочник): журнал и история для мастера. */
  const engineRecord = (kind: TurnRecord["kind"], label: string, text: string, effects: TurnEffect[] = []) => {
    records.push({
      kind, action: label, narration: text, beats: [{ speaker: null, text }], speaker: null, line: "",
      suggestions: [], response: null, applied: effects.length ? { ...emptyApplied(), notes: effects.map((e) => e.text), effects } : null, rolls: [], combatEvents: [],
      model: "engine", promptVersion: "-", usage: emptyUsage(), degraded: false,
    });
  };

  /** Служебная модель для дела: оценка ответов, реконструкция. */
  const utility = async (prompt: string) => {
    const { provider, model } = deps.router.route("utility");
    return provider.complete({ model, signal: deps.signal, maxTokens: 3000, reasoningEffort: "none", temperature: 0, messages: [{ role: "user", content: prompt }] });
  };

  const needCase = () => {
    if (!w.case) throw new GameError("В этом мире нет дел.");
    if (w.case.result) throw new GameError("Дело уже закрыто.");
    if (w.combat) throw new GameError("Идёт бой — выбери действие в бою.");
    return w.case;
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

  /** Плашка к последней записи: то, что изменил сам движок, а не мастер (поражение, срыв, вывод). */
  const addEffect = (e: TurnEffect, first = false) => {
    const rec = records.at(-1);
    const a = rec?.applied;
    if (!rec || !a) return;
    if (first) a.effects.unshift(e);
    else a.effects.push(e);
    // Вывод и срыв видны и в тексте — ярлыком в конце реплики.
    rec.beats = tagLast(rec.beats, [e]);
    if (rec.response) rec.response.beats = rec.beats;
  };

  const knockedOut = async (foes?: string) => {
    const { goldLost } = knockOut(c);
    await narrate("knockout", "Герой потерял сознание", systemActions.knockedOut(R.money.amount(goldLost), foes), { keepHp: true });
    if (goldLost) addEffect(effect.gold(-goldLost, R.money.amount(goldLost)));
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

  /** Рассудок кончился — срыв: половина рассудка возвращается, в деле теряется время. */
  const checkBroken = async () => {
    if (c.sanity !== 0 || w.combat) return;
    const { restored } = breakDown(c);
    let lost = 0;
    if (w.case && !w.case.result) {
      lost = Math.min(CASE_LIMITS.breakdownVisits, Math.max(0, w.case.limit - w.case.visits));
      w.case.visits += lost;
    }
    await narrate("breakdown", "Срыв", systemActions.breakdown(lost), { keepHp: true, keepSanity: true });
    if (restored) addEffect(effect.sanity(restored));
  };

  switch (input.kind) {
    case "start": {
      if (w.turn > 0) throw new GameError("Приключение уже началось.");
      const place = locationById(w, w.current)!;
      await deps.onArrive?.();
      const { resp } = await narrate("start", "Начало приключения", systemActions.start(place.name));
      await maybeStartCombat(resp);
      await checkBroken();
      break;
    }
    case "action": {
      if (w.combat) throw new GameError("Идёт бой — выбери действие в бою.");
      const text = input.text.trim().slice(0, MAX_ACTION_LENGTH);
      if (!text) throw new GameError("Напиши, что делает герой.");
      const { resp } = await narrate("action", text, text, { allowMove: true });
      await maybeStartCombat(resp);
      await checkDowned();
      await checkBroken();
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
        const roll = skillCheck(R, c, { skill: pick.check.skill, dc: pick.check.dc }, deps.rng);
        deps.emit?.({ type: "roll", roll });
        preRolls.push(roll);
        action = systemActions.checked(pick.text, roll.summary);
      }
      const { resp } = await narrate("choice", pick.text, action, { preRolls, allowMove: true });
      await maybeStartCombat(resp);
      await checkDowned();
      await checkBroken();
      break;
    }
    case "travel": {
      let t;
      try {
        // В деле — в любое известное место, каждый визит на счету; в квесте — по дорогам к соседям.
        t = w.case ? travelCase(R, w, input.to, deps.rng) : travel(R, w, input.to, deps.rng);
      } catch (e) {
        throw new GameError((e as Error).message);
      }
      await deps.onArrive?.();
      const late = "timeUp" in t && t.timeUp ? " Это последний визит: время вышло, после этой сцены герою придётся закрыть дело." : "";
      const { resp } = await narrate("travel", `Путь в «${t.to.name}»`, systemActions.travel(t.from.name, t.to.name, t.encounter) + late);
      await maybeStartCombat(resp);
      await checkDowned();
      await checkBroken();
      break;
    }
    case "rest": {
      if (w.combat) throw new GameError("Посреди боя не отдохнуть.");
      const missing = c.hpMax - c.hp;
      const { resp, applied } = await narrate("rest", "Привал", systemActions.rest(missing));
      // Отдых удался, если мастер вернул здоровье (или его и так хватало) и не начался бой.
      if (!resp.combat && (applied.hp > 0 || missing === 0)) c.abilityUses = R.classes[c.cls]?.ability.uses ?? 0;
      await maybeStartCombat(resp);
      await checkBroken();
      break;
    }
    case "lookup": {
      needCase();
      const q = input.query.trim().slice(0, 60);
      if (q.length < 3) throw new GameError("Напиши имя или название — хотя бы три буквы.");
      const hit = lookup(w, q);
      if (!hit) {
        engineRecord("lookup", `Справочник: «${q}»`, `В справочнике Аркхэма нет никого и ничего под именем «${q}».`);
        break;
      }
      const place = locationById(w, hit.place)!;
      const who = hit.person ? `${hit.person.name}, ${hit.person.role}. ` : "";
      engineRecord("lookup", `Справочник: «${q}»`, `${who}Адрес: ${place.name}.${hit.revealed ? " Новый адрес отмечен на карте." : ""}`, hit.revealed ? [effect.address(place.id, place.name)] : []);
      break;
    }
    case "reconstruct": {
      const cs = needCase();
      const text = input.text.trim().slice(0, MAX_ACTION_LENGTH);
      if (text.length < 10) throw new GameError("Опиши свою версию событий хотя бы одним предложением.");
      const candidates = deductionCandidates(w);
      if (!candidates.length) throw new GameError("Улик пока мало, чтобы сложить картину: ищи дальше.");
      const r = await utility(deducePrompt(cs.truth, candidates, text));
      const id = parseDeduction(r.text, candidates.map((d) => d.id));
      const d = id ? markDeduction(w, id) : null;
      await narrate("reconstruct", `Реконструкция: ${text}`, caseActions.reconstruct(text, d?.text ?? null), { extraUsage: r.usage });
      if (d) {
        records.at(-1)!.applied?.notes.unshift(`вывод: ${d.text}`);
        addEffect(effect.deduction(d.id, d.text), true);
      }
      await checkBroken();
      break;
    }
    case "close": {
      const cs = needCase();
      const answers = Object.fromEntries(cs.questions.map((q) => [q.id, String(input.answers?.[q.id] ?? "").trim().slice(0, MAX_ANSWER_LENGTH)]));
      if (!Object.values(answers).some(Boolean)) throw new GameError("Ответь хотя бы на один вопрос.");
      let verdicts: Record<string, Verdict> | null = null;
      let extra: Usage | undefined;
      try {
        const r = await utility(gradePrompt(cs.truth, cs.questions, answers));
        extra = r.usage;
        verdicts = parseVerdicts(r.text, cs.questions.map((q) => q.id));
      } catch {
        verdicts = null;
      }
      // Служебная модель не ответила — грубая проверка по словам, чтобы дело всё равно закрылось.
      verdicts ??= Object.fromEntries(cs.questions.map((q) => [q.id, roughVerdict(answers[q.id] ?? "", q.answer)]));
      const timeUp = cs.visits >= cs.limit;
      const result = closeCase(w, cs.questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? "", verdict: verdicts![q.id] ?? "wrong" })));
      const word = { right: "верно", partial: "отчасти верно", wrong: "неверно" } as const;
      const lines = cs.questions.map((q, i) => `${q.text} Ответ героя: «${answers[q.id] || "—"}» — ${word[result.answers[i]!.verdict]}.`);
      await narrate("close", "Дело закрыто", caseActions.close(lines, timeUp, isUnhinged(c)), { extraUsage: extra, keepSanity: true });
      break;
    }
    case "combat": {
      if (!w.combat) throw new GameError("Сейчас нет боя.");
      let step;
      try {
        step = playerMove(R, w.combat, c, input.move, deps.rng, input.target);
      } catch (e) {
        throw new GameError((e as Error).message);
      }
      combatRecord(input.move === "potion" ? R.healing.label : MOVE_LABELS[input.move], step.events, step.outcome);
      await finishCombat(step.outcome);
      await checkBroken();
      break;
    }
  }
  return { state, records };
}
