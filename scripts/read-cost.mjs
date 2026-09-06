#!/usr/bin/env node
/**
 * ЦЕНА ЧТЕНИЯ — сколько такта уходит на СЫРЬЁ и что было бы дешевле отдать подагенту.
 *
 * Постановка — тред `134-subagents-unused`. Считает две вещи, названные в ней:
 *   1. какая доля такта уходит на чтение — не «сколько раз позвали `cat`», а сколько СТОИТ
 *      носить прочитанное до конца такта;
 *   2. что дешевле на этом чтении — сильная модель напрямую или дешёвая через подагента.
 *
 * Источники — только то, что контур пишет сам:
 *   1. `.orchestrator/journal.jsonl` — `lease-released.usage`: модель, токены (in/out/
 *      cacheWrite/cacheRead) и ФАКТИЧЕСКАЯ цена такта в долларах;
 *   2. `.orchestrator/sessions/*.jsonl` — лента сессии: у каждого ответа модели стоит её usage,
 *      то есть РАЗМЕР КОНТЕКСТА на этом обращении (`cache_read + cache_creation`).
 *
 * Ключ замера — не оценка по знакам, а измеренный рост контекста. Разница размеров контекста
 * между двумя соседними обращениями к модели — это ровно то, что предыдущий шаг в него ДОБАВИЛ
 * (сочинение модели + ответы инструментов). Кусок в X токенов, добавленный на обращении k из N,
 * дальше едет во ВСЕХ обращениях k+1…N и оплачивается как cache-read каждое из них. Отсюда
 * «цена ношения» куска = X × (N − k) × цена cache-read. Сумма цен ношения по всем кускам равна
 * измеренному `cacheRead` такта — это и есть проверка сходимости (печатается как `свёртка`).
 *
 * Чего замер НЕ делает: он не запускает подагентов и не измеряет их ошибки. Часть про подагента
 * — арифметика на измеренных ценах: она отвечает «сколько сэкономил бы ИДЕАЛЬНЫЙ подагент»,
 * то есть даёт ПОТОЛОК выигрыша. Цена ошибок дешёвой модели в него не входит.
 *
 * Запуск: node scripts/read-cost.mjs [--since 2026-08-30] [--home <путь к .orchestrator>]
 * Ничего не пишет и ничего не отправляет.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const HOME = flag(
  "home",
  join(process.env.HOME ?? "", "projects/agent-crew-orchestrator/.orchestrator"),
);
const SINCE = flag("since", "1970-01-01");
/** Кусок сырья крупнее этого порога (токенов) считается «тяжёлым чтением» — кандидатом наружу. */
const HEAVY = Number(flag("heavy", "2000"));

// ── 1. Цены моделей: не из прайс-листа, а подогнаны под ФАКТИЧЕСКИЕ costUsd тактов ──────────────

/** Решает нормальные уравнения A·x = b методом Гаусса с выбором главного элемента. */
function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Цена за токен по каналам out/cacheWrite/cacheRead — МНК по тактам одной модели.
 * Канал `in` в подгонку не берётся: у такта роли он вырожден (десятки токенов при миллионах
 * прочих) и делает систему плохо обусловленной — его вклад в цену такта пренебрежим.
 */
function fitPrices(ticks) {
  const X = ticks.map((t) => [
    t.tokens.out / 1e6,
    t.tokens.cacheWrite / 1e6,
    t.tokens.cacheRead / 1e6,
  ]);
  const y = ticks.map((t) => t.costUsd);
  const A = Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)),
  );
  const b = Array.from({ length: 3 }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  const x = solve(A, b);
  if (!x) return null;
  const resid = X.reduce((s, r, k) => {
    const pred = r.reduce((a, v, i) => a + v * x[i], 0);
    return s + Math.abs(pred - y[k]);
  }, 0);
  // x — доллары за Mtok; наружу отдаём доллары за токен.
  return { out: x[0] / 1e6, cacheWrite: x[1] / 1e6, cacheRead: x[2] / 1e6, mae: resid / X.length };
}

// ── 2. Журнал контура: такты с фактической ценой ────────────────────────────────────────────────

const leases = [];
for (const line of readFileSync(join(HOME, "journal.jsonl"), "utf8").split("\n")) {
  if (!line) continue;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    continue;
  }
  if (d.kind !== "lease-released" || !d.usage?.tokens) continue;
  if (d.ts < SINCE) continue;
  leases.push({
    ts: d.ts,
    role: d.role,
    thread: d.thread,
    session: d.session,
    output: d.output,
    model: d.usage.model,
    turns: d.usage.turns,
    durationSec: d.usage.durationSec,
    costUsd: d.usage.costUsd,
    tokens: d.usage.tokens,
  });
}

const byModel = new Map();
for (const t of leases) {
  if (!byModel.has(t.model)) byModel.set(t.model, []);
  byModel.get(t.model).push(t);
}
const prices = new Map();
for (const [model, ts] of byModel) {
  if (ts.length < 20) continue;
  const p = fitPrices(ts);
  if (p) prices.set(model, p);
}

// ── 3. Ленты сессий: измеренный рост контекста и что его нарастило ──────────────────────────────

/** Грубая оценка токенов: кириллица дороже латиницы, и это надо учесть — прозу пишут по-русски. */
function estTokens(s) {
  if (!s) return 0;
  let nonAscii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) nonAscii++;
  return Math.round(nonAscii / 1.8 + (s.length - nonAscii) / 3.8);
}

function textOf(v) {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join("\n");
  if (v && typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (typeof v.content !== "undefined") return textOf(v.content);
    return JSON.stringify(v);
  }
  return "";
}

/** Куда отнести вызов инструмента. Классы — те же, что в `prose-cost.mjs`, плюс разделение чтения. */
function classify(name, input) {
  const cmd = typeof input?.command === "string" ? input.command : "";
  if (name === "Bash") {
    if (/(cli\.ts|protocol)\s+new-message\b/.test(cmd)) return "mail-send";
    if (/(cli\.ts|protocol)\s+(thread show|mail|thread status|await-input)\b/.test(cmd))
      return "mail-read";
    if (/\b(vitest|tsc|biome|pnpm|npm run|npx)\b/.test(cmd)) return "verify";
    if (/\bgh\s+(run|pr|api|workflow)\b/.test(cmd)) return "gh";
    if (/\bgit\s+(log|diff|show|blame|status)\b/.test(cmd)) return "git-read";
    if (/^\s*git\b|\bgit\s+(add|commit|push|checkout|rebase|fetch)\b/.test(cmd)) return "git-write";
    if (/\b(grep|rg|sed|cat|ls|head|tail|find|wc|awk|jq|python3|node)\b/.test(cmd))
      return "shell-read";
    return "other";
  }
  if (name === "Read" || name === "Grep" || name === "Glob" || name === "NotebookRead")
    return "file-read";
  if (name === "WebFetch" || name === "WebSearch") return "net-read";
  if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit")
    return "write";
  if (name === "Task" || name === "Agent") return "subagent";
  return "other";
}

/** Классы, которые считаются СЫРЬЁМ — тем, что подагент мог бы прочитать вместо роли. */
const RAW = new Set([
  "file-read",
  "shell-read",
  "git-read",
  "gh",
  "verify",
  "net-read",
  "mail-read",
]);

/**
 * Разбирает одну ленту: возвращает измеренные обращения к модели, размеры контекста и куски,
 * которыми контекст нарастал, с их классом.
 */
function readSession(path) {
  const events = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* обрезанная строка живой ленты */
    }
  }
  // Обращения к модели: подряд идущие assistant-события с одинаковым usage — это ОДНО обращение.
  const calls = [];
  const pendingTools = new Map(); // tool_use_id → {name, input}
  const toolClassById = new Map();
  let prose = 0; // оценка токенов, сочинённых с прошлого обращения
  let raw = []; // куски сырья, приехавшие с прошлого обращения: {cls, tok}
  let lastKey = null;
  for (const e of events) {
    if (e.type === "assistant" && e.message?.usage) {
      const u = e.message.usage;
      const ctx =
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.input_tokens ?? 0);
      const key = `${u.cache_read_input_tokens}/${u.cache_creation_input_tokens}`;
      if (key !== lastKey) {
        calls.push({ ctx, prose, raw });
        prose = 0;
        raw = [];
        lastKey = key;
      }
      for (const c of e.message.content ?? []) {
        if (c.type === "text" || c.type === "thinking")
          prose += estTokens(c.text ?? c.thinking ?? "");
        if (c.type === "tool_use") {
          pendingTools.set(c.id, { name: c.name, input: c.input });
          prose += estTokens(JSON.stringify(c.input ?? {}));
        }
      }
      continue;
    }
    if (e.type === "user") {
      const content = e.message?.content;
      const blocks = Array.isArray(content)
        ? content
        : [{ type: "text", text: String(content ?? "") }];
      for (const b of blocks) {
        if (b.type === "tool_result") {
          const t = pendingTools.get(b.tool_use_id);
          const cls = t ? classify(t.name, t.input) : "other";
          toolClassById.set(b.tool_use_id, cls);
          raw.push({ cls, tok: estTokens(textOf(b.content)) });
        } else {
          raw.push({ cls: "human", tok: estTokens(textOf(b)) });
        }
      }
    }
  }
  calls.push({ ctx: null, prose, raw }); // хвост: сочинённое после последнего обращения
  return calls;
}

/**
 * Раскладывает ИЗМЕРЕННЫЙ cacheRead такта на классы: база (системный промпт и карточка роли),
 * сочинение модели, сырьё по классам. Возвращает также перечень тяжёлых кусков сырья.
 */
function attribute(calls) {
  const measured = calls.filter((c) => c.ctx !== null);
  const N = measured.length;
  if (N < 2) return null;
  const chunks = []; // {cls, tokens, k} — приехало ПЕРЕД обращением k (0-based)
  chunks.push({ cls: "base", tokens: measured[0].ctx, k: 0 });
  for (let k = 1; k < N; k++) {
    const delta = measured[k].ctx - measured[k - 1].ctx;
    if (delta <= 0) continue; // сжатие контекста или ветвление ленты — кусок пропускаем
    const parts = [{ cls: "prose", tok: measured[k].prose }, ...measured[k].raw].filter(
      (p) => p.tok > 0,
    );
    // Оценка по знакам служит только ПРОПОРЦИЕЙ; сумма приравнивается к измеренной дельте.
    const totalEst = parts.reduce((a, b) => a + b.tok, 0) || 1;
    for (const p of parts) chunks.push({ cls: p.cls, tokens: (delta * p.tok) / totalEst, k });
  }
  const carry = new Map(); // класс → токено-обращений (то есть cache-read)
  const added = new Map(); // класс → токенов, добавленных в контекст
  const heavy = [];
  for (const c of chunks) {
    const carried = c.tokens * (N - 1 - c.k);
    carry.set(c.cls, (carry.get(c.cls) ?? 0) + carried);
    added.set(c.cls, (added.get(c.cls) ?? 0) + c.tokens);
    if (RAW.has(c.cls) && c.tokens >= HEAVY) heavy.push({ ...c, carried, remaining: N - 1 - c.k });
  }
  const totalCarry = [...carry.values()].reduce((a, b) => a + b, 0);
  return { N, chunks, carry, added, heavy, totalCarry };
}

// ── 4. Прогон по тактам ─────────────────────────────────────────────────────────────────────────

const sessionFiles = new Map();
for (const f of readdirSync(join(HOME, "sessions"))) {
  if (f.endsWith(".jsonl")) sessionFiles.set(basename(f, ".jsonl"), join(HOME, "sessions", f));
}

const rows = [];
for (const t of leases) {
  const stem = `${t.ts.slice(0, 19).replace(/:/g, "-")}Z`;
  let path = null;
  if (t.output) {
    const guess = t.output.replace(/\.log$/, ".jsonl");
    if (sessionFiles.has(basename(guess, ".jsonl"))) path = guess;
  }
  if (!path) {
    for (const [k, v] of sessionFiles) {
      if (k.includes(`-${t.role}-${t.thread}`) && k <= stem) path = v;
    }
  }
  if (!path) continue;
  let a;
  try {
    a = attribute(readSession(path));
  } catch {
    continue;
  }
  if (!a) continue;
  rows.push({ tick: t, attr: a });
}

// ── 5. Печать ───────────────────────────────────────────────────────────────────────────────────

const fmt = (n, d = 1) => n.toLocaleString("ru-RU", { maximumFractionDigits: d });
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");

console.log(`# Цена чтения — замер по ${rows.length} тактам (с ${SINCE})\n`);

console.log("## Цены моделей, подогнанные под фактические costUsd тактов\n");
console.log("| модель | тактов | out | cacheWrite | cacheRead | ошибка подгонки |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const [model, p] of prices) {
  const per = (v) => `$${(v * 1e6).toFixed(2)}/Mtok`;
  console.log(
    `| \`${model}\` | ${byModel.get(model).length} | ${per(p.out)} | ${per(p.cacheWrite)} | ${per(p.cacheRead)} | ±$${p.mae.toFixed(3)} |`,
  );
}

const CLASSES = [
  "base",
  "prose",
  "file-read",
  "shell-read",
  "git-read",
  "gh",
  "verify",
  "mail-read",
  "net-read",
  "write",
  "git-write",
  "human",
  "other",
  "subagent",
];
const sumCarry = new Map();
const sumAdded = new Map();
let grandCarry = 0;
let grandCost = 0;
let grandCacheRead = 0;
for (const r of rows) {
  grandCost += r.tick.costUsd;
  grandCacheRead += r.tick.tokens.cacheRead;
  for (const [cls, v] of r.attr.carry) {
    sumCarry.set(cls, (sumCarry.get(cls) ?? 0) + v);
    grandCarry += v;
  }
  for (const [cls, v] of r.attr.added) sumAdded.set(cls, (sumAdded.get(cls) ?? 0) + v);
}

console.log(
  `\n**Свёртка.** Расчётное ношение — ${fmt(grandCarry / 1e6, 1)} Mtok, измеренный cacheRead тактов — ${fmt(grandCacheRead / 1e6, 1)} Mtok (${pct(grandCarry, grandCacheRead)} от измеренного).\n`,
);

console.log("## На что уходит контекст такта\n");
console.log(
  "| класс | добавлено в контекст | доля добавленного | цена ношения (cache-read) | доля ношения |",
);
console.log("| --- | ---: | ---: | ---: | ---: |");
const totalAdded = [...sumAdded.values()].reduce((a, b) => a + b, 0);
for (const cls of CLASSES) {
  const a = sumAdded.get(cls) ?? 0;
  const c = sumCarry.get(cls) ?? 0;
  if (!a && !c) continue;
  console.log(
    `| ${cls} | ${fmt(a / 1e3, 0)} ktok | ${pct(a, totalAdded)} | ${fmt(c / 1e6, 1)} Mtok | ${pct(c, grandCarry)} |`,
  );
}
const rawCarry = CLASSES.filter((c) => RAW.has(c)).reduce((s, c) => s + (sumCarry.get(c) ?? 0), 0);
const rawAdded = CLASSES.filter((c) => RAW.has(c)).reduce((s, c) => s + (sumAdded.get(c) ?? 0), 0);
console.log(
  `\n**Сырьё целиком** (${[...RAW].join(", ")}): ${pct(rawAdded, totalAdded)} добавленного, ${pct(rawCarry, grandCarry)} ношения.\n`,
);

// ── 6. Потолок выигрыша от подагента ────────────────────────────────────────────────────────────

const strong = [...prices.keys()].find((m) => m.startsWith("claude-opus"));
const cheap = [...prices.keys()].find((m) => m.startsWith("claude-sonnet"));
const pS = prices.get(strong);
const pC = cheap ? prices.get(cheap) : null;
/** Во сколько раз выжимка короче сырья. Берётся из наблюдаемого сжатия, см. доку. */
const SQUEEZE = Number(flag("squeeze", "10"));

console.log("## Потолок выигрыша: тяжёлое чтение (≥ " + HEAVY + " токенов) наружу\n");
let heavyN = 0;
let heavyTok = 0;
let heavyCarry = 0;
for (const r of rows)
  for (const h of r.attr.heavy) {
    heavyN++;
    heavyTok += h.tokens;
    heavyCarry += h.carried;
  }
const heavyByClass = new Map();
for (const r of rows)
  for (const h of r.attr.heavy) {
    const e = heavyByClass.get(h.cls) ?? { n: 0, tok: 0, carried: 0 };
    e.n++;
    e.tok += h.tokens;
    e.carried += h.carried;
    heavyByClass.set(h.cls, e);
  }
console.log(
  `Тяжёлых кусков — ${heavyN} в ${rows.length} тактах (${(heavyN / rows.length).toFixed(1)} на такт), ` +
    `${fmt(heavyTok / 1e6, 2)} Mtok добавленного, ${fmt(heavyCarry / 1e6, 1)} Mtok ношения ` +
    `(${pct(heavyCarry, grandCarry)} всего ношения).\n`,
);

console.log("| класс сырья | тяжёлых кусков | добавлено | ношение |");
console.log("| --- | ---: | ---: | ---: |");
for (const [cls, e] of [...heavyByClass].sort((a, b) => b[1].carried - a[1].carried))
  console.log(
    `| ${cls} | ${e.n} | ${fmt(e.tok / 1e6, 2)} Mtok | ${fmt(e.carried / 1e6, 1)} Mtok (${pct(e.carried, grandCarry)}) |`,
  );
console.log("");

/**
 * Три цены одного и того же чтения: как сейчас, через подагента на сильной модели, через
 * подагента на дешёвой. `tok` — сколько сырья прочитано, `carried` — во сколько обошлось его
 * ношение до конца такта.
 */
function threeWays(tok, carried) {
  const outTok = tok / SQUEEZE;
  return {
    now: carried * pS.cacheRead + tok * pS.cacheWrite,
    // Подагент читает то же сырьё своим свежим контекстом (cacheWrite), пишет выжимку (out),
    // родитель носит только выжимку.
    viaStrong: tok * pS.cacheWrite + outTok * pS.out + (carried / SQUEEZE) * pS.cacheRead,
    viaCheap: pC
      ? tok * pC.cacheWrite + outTok * pC.out + (carried / SQUEEZE) * pS.cacheRead
      : null,
  };
}

if (pS) {
  const { now, viaStrong, viaCheap } = threeWays(heavyTok, heavyCarry);
  console.log("| путь | цена того же чтения |");
  console.log("| --- | ---: |");
  console.log(`| как сейчас: сырьё в контексте роли (${strong}) | $${now.toFixed(2)} |`);
  console.log(
    `| подагент на той же модели (${strong}), выжимка ÷${SQUEEZE} | $${viaStrong.toFixed(2)} |`,
  );
  if (viaCheap !== null)
    console.log(`| подагент на \`${cheap}\`, выжимка ÷${SQUEEZE} | $${viaCheap.toFixed(2)} |`);
  console.log(
    `\nЗа окно замера такты стоили $${grandCost.toFixed(2)}; тяжёлое чтение внутри них — $${now.toFixed(2)} (${pct(now, grandCost)}).`,
  );

  // Почту роль обязана читать САМА (`thread show` — норма протокола), выжимке она не подлежит.
  // Поэтому отдельно считается то, что подагенту отдать МОЖНО.
  const mail = heavyByClass.get("mail-read") ?? { tok: 0, carried: 0 };
  const t2 = heavyTok - mail.tok;
  const c2 = heavyCarry - mail.carried;
  const away = threeWays(t2, c2);
  console.log(`\n### То же без почты — сырьё, которое РАЗРЕШЕНО отдать наружу\n`);
  console.log("| путь | цена | экономия против «как сейчас» |");
  console.log("| --- | ---: | ---: |");
  console.log(`| как сейчас (${strong}) | $${away.now.toFixed(2)} | — |`);
  console.log(
    `| подагент на той же модели | $${away.viaStrong.toFixed(2)} | $${(away.now - away.viaStrong).toFixed(2)} (${pct(away.now - away.viaStrong, away.now)}) |`,
  );
  if (away.viaCheap !== null)
    console.log(
      `| подагент на \`${cheap}\` | $${away.viaCheap.toFixed(2)} | $${(away.now - away.viaCheap).toFixed(2)} (${pct(away.now - away.viaCheap, away.now)}) |`,
    );
  console.log(
    `\nПотолок экономии за окно — $${(away.now - (away.viaCheap ?? away.viaStrong)).toFixed(2)} из $${grandCost.toFixed(2)} (${pct(away.now - (away.viaCheap ?? away.viaStrong), grandCost)} счёта); ` +
      `из них смена модели даёт лишь $${(away.viaStrong - (away.viaCheap ?? away.viaStrong)).toFixed(2)}, остальное — сам вынос сырья из контекста.`,
  );
  console.log(
    `\n**Это ПОТОЛОК:** подагент считается идеальным — читает ровно то же, отвечает с первого раза, ` +
      `переспросов и повторных чтений нет. Цена ошибок не измерена (см. доку).`,
  );
}
