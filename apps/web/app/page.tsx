"use client";

import { useState } from "react";

/** Временная страница разработки: отправляет ход в /api/dev/turn и показывает поток ответа. */
export default function DevPage() {
  const [action, setAction] = useState("Подхожу к старику у колодца и спрашиваю о пропавших");
  const [narration, setNarration] = useState("");
  const [rolls, setRolls] = useState<string[]>([]);
  const [meta, setMeta] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setNarration("");
    setRolls([]);
    setMeta("");
    try {
      const res = await fetch("/api/dev/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "null");
          if (event === "narration") setNarration(data.text);
          if (event === "roll") setRolls((r) => [...r, data.summary]);
          if (event === "error") setMeta(`Ошибка: ${data.message}`);
          if (event === "done") {
            const line = data.response.line ? `\n\n${data.response.speaker?.name ?? "NPC"}: «${data.response.line}»` : "";
            setNarration(data.response.narration + line);
            setMeta(`${data.model} · запросов ${data.requests} · вход ${data.usage.inputTokens} / выход ${data.usage.outputTokens} ток. · $${data.usage.costUsd.toFixed(4)}${data.degraded ? " · JSON не разобран" : ""}\nПодсказки: ${data.response.suggestions.join(" | ")}${data.applied.notes.length ? `\nИзменения: ${data.applied.notes.join(" · ")}` : ""}`);
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontWeight: 400, letterSpacing: 1 }}>Хроники Пепла · стенд разработки</h1>
      <p style={{ opacity: 0.7 }}>Один ход на тестовом герое. Без ключа OpenRouter отвечает фейковая модель.</p>
      <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={3} style={{ width: "100%", background: "#211a15", color: "inherit", border: "1px solid #4a3a2c", padding: 12, fontSize: 16, boxSizing: "border-box" }} />
      <button onClick={send} disabled={busy} style={{ marginTop: 12, padding: "10px 20px", background: "#7a2c2c", color: "#f3e6d0", border: 0, fontSize: 16, cursor: "pointer" }}>
        {busy ? "Мастер пишет…" : "Сделать ход"}
      </button>
      {rolls.map((r, i) => (
        <p key={i} style={{ color: "#d9b25c" }}>🎲 {r}</p>
      ))}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 18, marginTop: 24 }}>{narration}</div>
      <pre style={{ whiteSpace: "pre-wrap", opacity: 0.6, fontSize: 13, marginTop: 24 }}>{meta}</pre>
    </main>
  );
}
