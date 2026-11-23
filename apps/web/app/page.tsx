"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getWorld } from "@ash/worlds";
import { api } from "@/lib/client";

const arkham = getWorld("arkham");
const MOTION_KEY = "arkham-motion";

interface Item {
  id: string;
  title: string;
  hero: string;
  world: string;
  turnNo: number;
  updatedAt: string;
}

export default function Home() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [llm, setLlm] = useState("");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [motion, setMotion] = useState(true);

  useEffect(() => {
    api<{ campaigns: Item[]; llm: string }>("/api/campaigns")
      .then((r) => (setItems(r.campaigns.filter((c) => c.world === "arkham")), setLlm(r.llm)))
      .catch((e) => setError(e.message));
    const reduced = window.localStorage.getItem(MOTION_KEY) === "off";
    setMotion(!reduced);
    document.documentElement.classList.toggle("reduce-motion", reduced);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setSettings(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [settings]);

  const changeMotion = (enabled: boolean) => {
    setMotion(enabled);
    window.localStorage.setItem(MOTION_KEY, enabled ? "on" : "off");
    document.documentElement.classList.toggle("reduce-motion", !enabled);
  };

  return (
    <main className="wrap home-arkham">
      <div className="home-kicker">Аркхэм · 1926</div>
      <h1 className="hero-title">{arkham.title}</h1>
      <p className="home-tagline">{arkham.tagline}. Каждая встреча — разговор, выбор и последствия.</p>
      {llm === "fake" && <p className="small muted">Режим разработки: отвечает фейковая модель (нет ключа OpenRouter).</p>}
      <div className="home-actions">
        <Link href="/new?world=arkham" className="btn">Начать новое дело</Link>
        <button className="btn ghost" onClick={() => setSettings(true)}>Настройки</button>
      </div>
      {error && <p className="error">{error}</p>}
      {items && items.length > 0 && (
        <div className="list home-cases">
          <h2>Продолжить дело</h2>
          {items.map((c) => (
            <Link key={c.id} href={`/play/${c.id}`}>
              <div className="card">
                <div style={{ fontSize: 19 }}>{c.title}</div>
                <div className="small muted">
                  Ходов: {c.turnNo} · {new Date(c.updatedAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {settings && (
        <div className="settings-veil" onClick={() => setSettings(false)}>
          <section className="settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="settings-title">Настройки</h2>
            <label className="settings-toggle">
              <input type="checkbox" checked={motion} onChange={(e) => changeMotion(e.target.checked)} />
              <span>Анимация интерфейса</span>
            </label>
            <p className="small muted">Настройка сохраняется в этом браузере.</p>
            <button className="btn ghost" onClick={() => setSettings(false)} autoFocus>Готово</button>
          </section>
        </div>
      )}
    </main>
  );
}
