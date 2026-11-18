"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isWorldId, getWorld, WORLDS } from "@ash/worlds";
import { api } from "@/lib/client";

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

  useEffect(() => {
    api<{ campaigns: Item[]; llm: string }>("/api/campaigns")
      .then((r) => (setItems(r.campaigns), setLlm(r.llm)))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="wrap">
      <h1 className="hero-title">Хроники Пепла</h1>
      <p className="muted">Ролевая игра, где историю пишет ИИ-мастер, а исход решают кубики. Выбери мир.</p>
      {llm === "fake" && <p className="small muted">Режим разработки: отвечает фейковая модель (нет ключа OpenRouter).</p>}
      <div className="worlds-list">
        {WORLDS.map((w) => (
          <Link key={w.id} href={`/new?world=${w.id}`} className={`world-card world-${w.id}`}>
            <div className="world-title">{w.title}</div>
            <div className="small muted">{w.tagline}</div>
            <span className="btn small">Новый герой</span>
          </Link>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {items && items.length > 0 && (
        <div className="list">
          <h2 style={{ marginTop: 24 }}>Продолжить</h2>
          {items.map((c) => (
            <Link key={c.id} href={`/play/${c.id}`}>
              <div className="card">
                <div style={{ fontSize: 19 }}>{c.title}</div>
                <div className="small muted">
                  {isWorldId(c.world) ? `${getWorld(c.world).title} · ` : ""}
                  {c.hero} · ходов: {c.turnNo} · {new Date(c.updatedAt).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
