/**
 * Делает из прогона анонимный бюллетень — один HTML-файл, открывается в браузере.
 *   pnpm arena:ballot tools/arena/out/run-….json
 * Ответы в каждой сцене перемешаны и подписаны буквами. Оценки 1–5 по трём критериям;
 * кнопка «Показать итоги» раскрывает модели и средние баллы, «Скачать оценки» сохраняет JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hashStr, mulberry32 } from "@ash/engine";

const file = process.argv.slice(2).find((a) => a !== "--");
if (!file) {
  console.error("Укажи файл прогона: pnpm arena:ballot tools/arena/out/run-….json");
  process.exit(1);
}
const run = JSON.parse(readFileSync(file, "utf8"));

const scenes = run.scenes.map((s: any) => {
  const answers = run.results.filter((r: any) => r.scene === s.id && !r.error);
  const R = mulberry32(hashStr(file + s.id));
  for (let i = answers.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }
  return {
    id: s.id, title: s.title, checks: s.checks, action: s.action,
    answers: answers.map((a: any, i: number) => ({
      label: String.fromCharCode(65 + i), model: a.model, rolls: a.rolls, degraded: a.degraded,
      narration: a.response.narration, speaker: a.response.speaker?.name ?? "", line: a.response.line,
      suggestions: a.response.suggestions.map((s: any) => (typeof s === "string" ? s : s.check ? `[${s.check.skill} ${s.check.dc}] ${s.text}` : s.text)), changes: a.response.changes, combat: a.response.combat,
      questDone: a.response.questDone, questComplete: a.response.questComplete,
      cost: a.usage.costUsd, ms: a.ms,
    })),
  };
});

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Слепой тест рассказчиков</title><style>
body{margin:0;background:#15110e;color:#e8dcc8;font:17px/1.6 Georgia,serif}main{max-width:900px;margin:0 auto;padding:32px 20px 80px}
h1{font-weight:400}h2{font-weight:400;border-top:1px solid #3a2e24;padding-top:28px;margin-top:40px}.muted{opacity:.65;font-size:14px}
.card{background:#1e1813;border:1px solid #3a2e24;padding:18px 20px;margin:16px 0;border-radius:6px}.label{font-size:22px;color:#d9b25c}
.line{font-style:italic;color:#e6c89a}.meta{font:13px/1.5 ui-monospace,monospace;opacity:.7;white-space:pre-wrap}
.rate{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:14px}.rate select{background:#2a211a;color:inherit;border:1px solid #4a3a2c}
button{background:#7a2c2c;color:#f3e6d0;border:0;padding:10px 18px;font-size:16px;cursor:pointer;margin-right:8px}
table{border-collapse:collapse;margin-top:16px}td,th{border:1px solid #3a2e24;padding:6px 12px;text-align:left}.model{display:none;color:#8fc18f}
body.revealed .model{display:inline}</style></head><body><main>
<h1>Слепой тест рассказчиков</h1>
<p class="muted">Оцени каждый ответ от 1 до 5. Модели скрыты до конца. Критерии: <b>язык</b> — живой ли русский; <b>мастер</b> — соблюдены ли правила из подсказки к сцене; <b>интерес</b> — хочется ли играть дальше.</p>
<div id="scenes"></div>
<p><button onclick="reveal()">Показать итоги</button><button onclick="download()">Скачать оценки</button></p>
<div id="results"></div></main>
<script>
const DATA=${JSON.stringify({ scenes }).replace(/</g, "\\u003c")};
const crit=[["lang","язык"],["gm","мастер"],["fun","интерес"]];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const root=document.getElementById("scenes");
root.innerHTML=DATA.scenes.map(s=>\`<h2>\${esc(s.title)}</h2><p class="muted">Ход игрока: \${esc(s.action)}<br>Что проверить: \${esc(s.checks)}</p>\`+
 s.answers.map(a=>\`<div class="card"><div class="label">\${a.label} <span class="model">— \${esc(a.model)}</span></div>
 \${a.rolls.length?\`<p class="meta">🎲 \${a.rolls.map(esc).join("\\n🎲 ")}</p>\`:""}
 \${a.narration.split(/\\n+/).map(p=>\`<p>\${esc(p)}</p>\`).join("")}
 \${a.line?\`<p class="line">\${esc(a.speaker||"NPC")}: «\${esc(a.line)}»</p>\`:""}
 <p class="meta">Подсказки: \${a.suggestions.map(esc).join(" | ")}
Изменения: \${esc(JSON.stringify(a.changes))}\${a.combat?"\\nБой: "+esc(JSON.stringify(a.combat.enemies)):""}\${a.questDone.length?"\\nЦели: "+esc(a.questDone.join(",")):""}\${a.questComplete?" · квест завершён":""}\${a.degraded?"\\n⚠ JSON не разобран":""}</p>
 <div class="rate">\${crit.map(([k,n])=>\`<label>\${n} <select data-s="\${s.id}" data-a="\${a.label}" data-k="\${k}"><option value="">—</option>\${[1,2,3,4,5].map(v=>\`<option>\${v}</option>\`).join("")}</select></label>\`).join("")}</div></div>\`).join("")).join("");
function scores(){const out=[];document.querySelectorAll("select").forEach(el=>{if(!el.value)return;const s=DATA.scenes.find(x=>x.id===el.dataset.s),a=s.answers.find(x=>x.label===el.dataset.a);out.push({scene:s.id,model:a.model,criterion:el.dataset.k,score:+el.value})});return out}
function reveal(){document.body.classList.add("revealed");const by={};for(const r of scores()){(by[r.model]??={lang:[],gm:[],fun:[]})[r.criterion].push(r.score)}
 const cost={},ms={};for(const s of DATA.scenes)for(const a of s.answers){(cost[a.model]??=[]).push(a.cost);(ms[a.model]??=[]).push(a.ms)}
 const avg=a=>a&&a.length?(a.reduce((x,y)=>x+y,0)/a.length):NaN;
 const rows=Object.keys(cost).map(m=>{const b=by[m]||{};const all=[...(b.lang||[]),...(b.gm||[]),...(b.fun||[])];return[m,avg(b.lang),avg(b.gm),avg(b.fun),avg(all),avg(cost[m]),avg(ms[m])]}).sort((x,y)=>(y[4]||0)-(x[4]||0));
 const f=(v,d=2)=>Number.isNaN(v)?"—":v.toFixed(d);
 document.getElementById("results").innerHTML="<table><tr><th>Модель</th><th>Язык</th><th>Мастер</th><th>Интерес</th><th>Среднее</th><th>$ за ход</th><th>Время, с</th></tr>"+rows.map(r=>\`<tr><td>\${esc(r[0])}</td><td>\${f(r[1])}</td><td>\${f(r[2])}</td><td>\${f(r[3])}</td><td><b>\${f(r[4])}</b></td><td>\${f(r[5],4)}</td><td>\${f(r[6]/1000,1)}</td></tr>\`).join("")+"</table>"}
function download(){const b=new Blob([JSON.stringify(scores(),null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const l=document.createElement("a");l.href=u;l.download="arena-scores.json";l.click()}
</script></body></html>`;

const out = file.replace(/\.json$/, ".html");
writeFileSync(out, html);
console.log(`Бюллетень: ${out}`);
