"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, MessageSquare, Users, X } from "lucide-react";
import { useState } from "react";
import { attitudeWord, locationById, sameName, type PublicCampaign } from "@ash/engine";
import { CaseResultView } from "./case";

export type DossierTab = "clues" | "testimony" | "people";

const placeName = (w: PublicCampaign, id: string) => locationById(w, id)?.name ?? "Запись следователя";
const two = (n: number) => String(n).padStart(2, "0");

/** Досье Аркхэма: только уже найденные улики, услышанные показания и известные люди. */
export function ArkhamDossier({
  open,
  onOpenChange,
  w,
  busy,
  selectedClue,
  onSelectClue,
  tab,
  onTabChange,
  focus,
  onReconstruct,
  onCloseCase,
  onPresent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  w: PublicCampaign;
  busy: boolean;
  selectedClue: string;
  onSelectClue: (id: string) => void;
  tab: DossierTab;
  onTabChange: (tab: DossierTab) => void;
  focus?: string | null;
  onReconstruct: (text: string) => void;
  onCloseCase: () => void;
  onPresent: (clueId: string) => void;
}) {
  const c = w.case!;
  const [version, setVersion] = useState("");
  const memories = [...(w.memory ?? [])].sort((a, b) => b.met - a.met);
  const testimony = memories.flatMap((m) => m.told.map((text, index) => ({ ...m, text, key: `${m.name}-${index}` })));
  const people = [...c.people];
  for (const m of memories) {
    if (!people.some((p) => sameName(p.name, m.name))) people.push({ name: m.name, role: m.role, at: m.at });
  }
  const selected = c.clues.find((x) => x.id === selectedClue) ?? c.clues[0];
  const tabs: { id: DossierTab; label: string; icon: typeof BookOpen; count: number }[] = [
    { id: "clues", label: "Улики", icon: BookOpen, count: c.clues.length },
    { id: "testimony", label: "Показания", icon: MessageSquare, count: testimony.length },
    { id: "people", label: "Люди", icon: Users, count: people.length },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="arkham-overlay" />
        <Dialog.Content className={`arkham-dossier dossier-${tab}`}>
          <aside className="dossier-rail">
            <div className="archive-mark">
              <span>Архив расследования</span>
              <strong>{two(c.visits)}</strong>
              <small>Аркхэм · 1926</small>
            </div>
            <nav className="dossier-tabs" aria-label="Разделы досье">
              {tabs.map(({ id, label, icon: TabIcon, count }) => (
                <button
                  type="button"
                  key={id}
                  className={`dossier-tab ${tab === id ? "is-active" : ""}`}
                  onClick={() => onTabChange(id)}
                  aria-pressed={tab === id}
                >
                  <TabIcon size={17} strokeWidth={1.35} aria-hidden="true" />
                  <span>{label}</span>
                  <small>{two(count)}</small>
                </button>
              ))}
            </nav>
            <p className="rail-note">Всё, что нельзя<br />оставить без внимания</p>
          </aside>

          <div className="dossier-content">
            <header className="dossier-header">
              <div>
                <span className="eyebrow">Материалы дела · визит {c.visits} из {c.limit}</span>
                <Dialog.Title>{w.questTitle}</Dialog.Title>
                <Dialog.Description>Найденное, услышанное и записанное следователем</Dialog.Description>
              </div>
              <Dialog.Close className="icon-button close-button" aria-label="Закрыть досье">
                <X size={22} strokeWidth={1.35} />
              </Dialog.Close>
            </header>
            <div className="paper-divider" aria-hidden="true" />

            <div className="dossier-body">
              {tab === "clues" && (
                <>
                  {selected ? (
                    <div className="clues-layout">
                      <div className="clue-list" aria-label="Найденные улики">
                        {c.clues.map((clue, index) => (
                          <button
                            type="button"
                            key={clue.id}
                            className={`clue-row ${selected.id === clue.id ? "is-selected" : ""}`}
                            onClick={() => onSelectClue(clue.id)}
                            aria-pressed={selected.id === clue.id}
                          >
                            <span className="clue-number">{two(index + 1)}</span>
                            <span>
                              <strong>{clue.title || (clue.requires ? "Вывод следователя" : "Найденная улика")}</strong>
                              <small>{clue.requires ? "Реконструкция" : placeName(w, clue.at)}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                      <article className="clue-detail" key={selected.id}>
                        <div className={`clue-image-wrap evidence-record ${selected.requires ? "is-deduction" : ""}`}>
                          <span className="evidence-index">{two(c.clues.findIndex((x) => x.id === selected.id) + 1)}</span>
                          <i className="evidence-clip" aria-hidden="true" />
                          <span>{selected.requires ? "Вывод" : "Улика"}</span>
                        </div>
                        <div className="clue-copy">
                          <span className="eyebrow">{selected.requires ? "Сложено из находок" : "Материальная находка"}</span>
                          <h3>{selected.title || "Запись в досье"}</h3>
                          <p>{selected.text}</p>
                          <span className="clue-place">{selected.requires ? `Основано на ${selected.requires.length} уликах` : placeName(w, selected.at)}</span>
                          {w.npc && !selected.requires && !c.result && (
                            <button className="texture-button clue-present" disabled={busy} onClick={() => onPresent(selected.id)}>
                              Показать: {w.npc.name}
                            </button>
                          )}
                        </div>
                      </article>
                    </div>
                  ) : (
                    <div className="dossier-empty">
                      <BookOpen size={30} strokeWidth={1.1} aria-hidden="true" />
                      <h3>Страница пока пуста</h3>
                      <p>Осматривайте вещи и бумаги, расспрашивайте свидетелей. Найденное появится здесь без раскрытия ещё не обнаруженных улик.</p>
                    </div>
                  )}

                  {!c.result && (
                    <section className="case-workbench" aria-label="Реконструкция дела">
                      <div className="case-progress">
                        <span className="eyebrow">Ход расследования</span>
                        <p>{w.objectives.map((o) => `${o.done ? "✓" : "○"} ${o.text}`).join(" · ")}</p>
                      </div>
                      <label htmlFor="case-version">Сложить картину</label>
                      <textarea
                        id="case-version"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        rows={2}
                        maxLength={500}
                        placeholder={c.canDeduce > 0 ? "Опишите своими словами, что произошло…" : "Нужно найти больше связанных улик"}
                        disabled={busy || c.canDeduce === 0}
                      />
                      <div className="case-workbench-actions">
                        <button className="quiet-button" disabled={busy || c.canDeduce === 0 || version.trim().length < 10} onClick={() => onReconstruct(version.trim())}>
                          Записать вывод
                        </button>
                        <button className="texture-button" disabled={busy} onClick={onCloseCase}>Закрыть дело…</button>
                      </div>
                    </section>
                  )}
                </>
              )}

              {tab === "testimony" && (
                <div className="testimony-view">
                  <span className="eyebrow">Записано со слов</span>
                  {testimony.length ? testimony.map((m, index) => (
                    <blockquote key={m.key} className={focus && sameName(m.name, focus) ? "is-focused" : ""}>
                      <span className="testimony-status">{index === 0 ? "Последняя запись" : attitudeWord(m.attitude)}</span>
                      <p>«{m.text}»</p>
                      <footer>{m.name}{m.role ? ` · ${m.role}` : ""}</footer>
                    </blockquote>
                  )) : (
                    <p className="dossier-empty-line">Показаний пока нет. Слова собеседников, которые могут пригодиться расследованию, будут записаны здесь.</p>
                  )}
                </div>
              )}

              {tab === "people" && (
                <div className="people-view">
                  <span className="eyebrow">Связанные с делом</span>
                  {people.length ? people.map((person, index) => {
                    const memory = memories.find((m) => sameName(m.name, person.name));
                    return (
                      <div className={`person-line ${focus && sameName(person.name, focus) ? "is-focused" : ""}`} key={person.name}>
                        <span>{two(index + 1)}</span>
                        <div><strong>{person.name}</strong><small>{person.role} · {placeName(w, person.at)}</small></div>
                        <em>{memory ? `${attitudeWord(memory.attitude)} · встреча записана` : "Пока не опрошен"}</em>
                      </div>
                    );
                  }) : <p className="dossier-empty-line">Известные участники дела появятся после знакомства или обнаружения их адресов.</p>}
                </div>
              )}

              {c.result && <CaseResultView c={c} />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
