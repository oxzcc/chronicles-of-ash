"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Item {
  id: string;
  title: string;
  hero: string;
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
      <p className="muted">Тёмное фэнтези, где историю пишет мастер, а исход решают кубики.</p>
      {llm === "fake" && <p className="small muted">Режим разработки: отвечает фейковая модель (нет ключа OpenRouter).</p>}
      <div className="row" style={{ marginTop: 20 }}>
        <Link href="/new" className="btn" style={{ textDecoration: "none" }}>
          Новый герой
        </Link>
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
