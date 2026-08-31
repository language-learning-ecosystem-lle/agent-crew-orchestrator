#!/usr/bin/env node
/**
 * ЦЕНА ПРОЗЫ — замер такта: сколько его уходит на работу, сколько на письма о работе.
 *
 * Источники — только то, что контур пишет сам, без опроса ролей:
 *   1. `.orchestrator/journal.jsonl` — границы такта (`lease-acquired` … `lease-released`)
 *      и расход модели (`usage`);
 *   2. `.orchestrator/sessions/*.jsonl` — лента сессии: каждый инструментальный вызов с меткой
 *      времени и с ПОЛНЫМ текстом, который модель для него сочинила.
 *
 * Интервал между двумя соседними вызовами относится К ПОЗДНЕМУ из них: он покрывает исполнение
 * предыдущего инструмента и сочинение следующего. Так «минуты письма» — это время, за которое
 * письмо было СОЧИНЕНО, а не длина команды.
 *
 * Запуск: node scripts/prose-cost.mjs --since 2026-08-30 [--home <путь к .orchestrator>]
 * Печатает markdown-таблицу по тактам и сводку. Ничего не пишет и ничего не отправляет.
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

/** Тело heredoc из команды: `cat > "$TMP/msg.md" <<'EOF' … EOF`. */
function heredocBody(command) {
  const start = command.indexOf("<<'EOF'");
  if (start < 0) return "";
  const rest = command.slice(start + 7);
  const end = rest.indexOf("\nEOF");
  return end < 0 ? rest : rest.slice(0, end);
}

/** Куда отнести вызов: mail-send / mail-read / pr-prose / verify / code / git / explore / other. */
function classify(name, input) {
  const cmd = typeof input?.command === "string" ? input.command : "";
  if (name === "Bash") {
    if (/(cli\.ts|protocol)\s+new-message\b/.test(cmd)) return "mail-send";
    if (/(cli\.ts|protocol)\s+await-input\b/.test(cmd)) return "mail-wait";
    if (/(cli\.ts|protocol)\s+(thread show|mail|thread status)\b/.test(cmd)) return "mail-read";
    if (/gh pr (create|edit)/.test(cmd)) return "pr-prose";
    if (/\b(vitest|tsc|biome|pnpm|npm run|npx tsc)\b/.test(cmd)) return "verify";
    if (/^\s*(git|gh )|\bgit (add|commit|push|checkout|rebase|status|log|diff)\b/.test(cmd))
      return "git";
    if (/\b(grep|rg|sed|cat|ls|head|tail|find|wc|awk)\b/.test(cmd)) return "explore";
    return "other";
  }
  if (name === "Read" || name === "Grep" || name === "Glob" || name === "WebFetch")
    return "explore";
  if (name === "Edit" || name === "Write" || name === "NotebookEdit") {
    const p = String(input?.file_path ?? "");
    if (!p.startsWith("/tmp")) return "code";
    // тело письма и заготовка описания PR пишутся во временный файл; описание PR открывается
    // шапкой `thread:` по шаблону — этим они и различаются
    return /^\s*thread:\s/.test(String(input?.content ?? "")) ? "pr-prose" : "mail-send";
  }
  if (name === "TodoWrite") return "other";
  return "other";
}

/** Ленты сессий: файл → { role, thread, calls[] }. */
function readSession(path) {
  const calls = [];
  const tmpFiles = new Map();
  let first = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = d.timestamp ? Date.parse(d.timestamp) : null;
    if (d.type === "user" && ts) {
      calls.push({ ts, kind: "result" });
      continue;
    }
    if (d.type !== "assistant") continue;
    if (ts && first === null) first = ts;
    for (const b of d.message?.content ?? []) {
      if (b.type === "text") {
        calls.push({ ts, kind: "text", chars: (b.text ?? "").length, cat: "text" });
      } else if (b.type === "tool_use") {
        const input = b.input ?? {};
        const raw = JSON.stringify(input);
        const cat = classify(b.name, input);
        const cmd = String(input.command ?? "");
        if (
          (b.name === "Write" || b.name === "Edit") &&
          String(input.file_path ?? "").startsWith("/tmp")
        ) {
          tmpFiles.set(String(input.file_path), String(input.content ?? input.new_string ?? ""));
        }
        let bodyChars = 0;
        let body = "";
        let thread = null;
        let awaits = false;
        if (cat === "mail-send" && b.name === "Bash") {
          const heredoc = heredocBody(cmd);
          const viaFile = cmd.match(/--body-file\s+"?([^\s"]+)"?/);
          const resolved = viaFile ? tmpFiles.get(viaFile[1].replace("$TMP", "")) : undefined;
          body = heredoc || resolved || "";
          if (!body && viaFile) {
            // тело писалось в файл, чьё имя собрано в шелле: берём последний записанный /tmp-файл
            body = [...tmpFiles.values()].pop() ?? "";
          }
          bodyChars = body.length;
          thread = (cmd.match(/--thread\s+([\w.-]+)/) ?? [])[1] ?? null;
          awaits = /--await-input/.test(cmd);
        }
        calls.push({
          ts,
          kind: "tool",
          name: b.name,
          cat,
          chars: raw.length,
          bodyChars,
          body,
          thread,
          awaits,
        });
      }
    }
  }
  return { first, calls };
}

// --- журнал: такты ---
const journal = readFileSync(join(HOME, "journal.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const ticks = journal.filter(
  (e) => e.kind === "lease-released" && (e.ts ?? "") >= SINCE && e.output,
);

const CATS = [
  "mail-send",
  "mail-read",
  "pr-prose",
  "code",
  "verify",
  "git",
  "explore",
  "other",
  "mail-wait",
];
const rows = [];
for (const t of ticks) {
  const sessionPath = t.output.replace(/\.log$/, ".jsonl");
  let s;
  try {
    s = readSession(sessionPath);
  } catch {
    continue;
  }
  const end = Date.parse(t.ts);
  const tools = s.calls.filter((c) => c.kind === "tool" && c.ts);
  if (!tools.length) continue;
  // СОЧИНЕНИЕ отделено от ИСПОЛНЕНИЯ: сочинение — от предыдущего события ленты (чаще всего ответа
  // инструмента) до вызова; исполнение — от вызова до его ответа. Прогон тестов не записывается
  // в цену письма только потому, что письмо шло следом.
  const minutes = Object.fromEntries(CATS.map((c) => [c, 0]));
  const exec = Object.fromEntries(CATS.map((c) => [c, 0]));
  const timeline = s.calls.filter((c) => c.ts);
  let prev = s.first ?? tools[0].ts;
  for (let i = 0; i < timeline.length; i++) {
    const c = timeline[i];
    if (c.kind === "tool") {
      minutes[c.cat] += Math.max(0, (c.ts - prev) / 60000);
      const next = timeline.slice(i + 1).find((x) => x.kind === "result");
      if (next) exec[c.cat] += Math.max(0, (next.ts - c.ts) / 60000);
    }
    prev = c.ts;
  }
  // хвост от последнего события до освобождения аренды — это тоже сочинение (последнее письмо/итог)
  const tail = Math.max(0, (end - prev) / 60000);
  const lastCat = tools[tools.length - 1].cat;
  minutes[lastCat === "mail-send" ? "mail-send" : "other"] += tail;

  const letters = tools.filter((c) => c.cat === "mail-send" && c.name === "Bash");
  const letterChars = letters.reduce((a, c) => a + c.bodyChars, 0);
  const producedChars = s.calls.reduce((a, c) => a + (c.chars ?? 0), 0);
  const proseChars = tools
    .filter((c) => c.cat === "mail-send" || c.cat === "pr-prose")
    .reduce((a, c) => a + c.chars, 0);
  const durMin = (end - (s.first ?? tools[0].ts)) / 60000;
  rows.push({
    role: t.role,
    thread: t.thread,
    start: new Date(s.first ?? tools[0].ts).toISOString().slice(5, 16).replace("T", " "),
    durMin,
    minutes,
    exec,
    letters: letters.length,
    plainLetters: letters.filter((c) => !c.awaits).length,
    letterChars,
    letterSizes: letters.map((c) => c.bodyChars),
    letterBodies: letters.map((c) => c.body ?? ""),
    producedChars,
    proseChars,
    outTokens: t.usage?.tokens?.out ?? 0,
    costUsd: t.usage?.costUsd ?? 0,
    reason: t.reason,
    session: basename(sessionPath),
  });
}

const med = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const f1 = (x) => x.toFixed(1);
const pct = (x, y) => (y ? `${((100 * x) / y).toFixed(0)}%` : "—");

const real = rows.filter((r) => r.minutes["mail-wait"] < 1); // такты с парковкой на ввод — отдельный жанр

console.log(`# Цена прозы — замер по журналу контура (с ${SINCE})\n`);
console.log(
  `Тактов в выборке: **${rows.length}** (из них без парковки на ввод: ${real.length}).\n`,
);

console.log("## Такты\n");
console.log(
  "| начало | роль | тред | такт, мин | письма, мин | доля | код+тесты, мин | писем | знаков |",
);
console.log("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of rows.sort((a, b) => b.minutes["mail-send"] - a.minutes["mail-send"])) {
  const mail = r.minutes["mail-send"] + r.minutes["pr-prose"];
  const work = r.minutes.code + r.minutes.verify;
  console.log(
    `| ${r.start} | ${r.role} | ${r.thread} | ${f1(r.durMin)} | ${f1(mail)} | ${pct(mail, r.durMin)} | ${f1(work)} | ${r.letters} | ${r.letterChars} |`,
  );
}

const mailMin = rows.map((r) => r.minutes["mail-send"] + r.minutes["pr-prose"]);
const totalMin = sum(rows.map((r) => r.durMin));
console.log("\n## Сводка\n");
console.log(
  `- всего тактового времени: **${f1(totalMin)} мин**, из них на письма и описания PR: **${f1(sum(mailMin))} мин (${pct(sum(mailMin), totalMin)})**;`,
);
console.log(
  `- медиана такта: ${f1(med(rows.map((r) => r.durMin)))} мин; медиана «минут письма» в такте: ${f1(med(mailMin))} мин;`,
);
console.log(
  `- знаков, сочинённых моделью за такт (медиана): ${med(rows.map((r) => r.producedChars))}; из них проза почты/PR: ${med(rows.map((r) => r.proseChars))};`,
);
const sizes = rows.flatMap((r) => r.letterSizes).filter((x) => x > 0);
console.log(
  `- писем всего: ${sum(rows.map((r) => r.letters))}; медиана письма: ${med(sizes)} знаков; p90: ${[...sizes].sort((a, b) => a - b)[Math.floor(sizes.length * 0.9)] ?? 0}; максимум: ${Math.max(0, ...sizes)};`,
);
const multi = rows.filter((r) => r.letters > 1);
const follow = rows.filter((r) => r.plainLetters > 1);
console.log(
  `- тактов с более чем одним письмом: ${multi.length} из ${rows.length} (${pct(multi.length, rows.length)}); из них БЕЗ парковки на ввод, то есть добавка/поправка к своему же письму: ${follow.length} (${pct(follow.length, rows.length)});`,
);
const shares = rows.filter((r) => r.producedChars > 0).map((r) => r.proseChars / r.producedChars);
console.log(
  `- доля прозы почты/PR в сочинённых знаках такта: медиана ${(100 * med(shares)).toFixed(0)}%;`,
);
console.log(
  `- деньги: всего $${sum(rows.map((r) => r.costUsd)).toFixed(2)} за выборку, медиана такта $${med(rows.map((r) => r.costUsd)).toFixed(2)};`,
);
const byCat = Object.fromEntries(CATS.map((c) => [c, sum(rows.map((r) => r.minutes[c]))]));
const byExec = Object.fromEntries(CATS.map((c) => [c, sum(rows.map((r) => r.exec[c]))]));
console.log("\n| категория | сочинение, мин | исполнение, мин | доля такта |");
console.log("| --- | ---: | ---: | ---: |");
for (const c of CATS)
  console.log(
    `| ${c} | ${f1(byCat[c])} | ${f1(byExec[c])} | ${pct(byCat[c] + byExec[c], totalMin)} |`,
  );

// --- письма одного такта: дублирует ли второе письмо первое, и насколько письмо фактично ---
const normLine = (l) =>
  l
    .toLowerCase()
    .replace(/[`*_>#|]/g, "")
    .replace(/^\s*[-–—•\d.]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
const contentLines = (text) =>
  text
    .split("\n")
    .map(normLine)
    .filter((l) => l.length >= 40);
/** Строка «несёт факт», если в ней есть число, путь/идентификатор в бэктиках, ссылка на PR/тред. */
const factual = (raw) => /\d|`|#\d+|PR |SHA|тред/.test(raw);

let sibLines = 0;
let sibDup = 0;
const sibTicks = [];
for (const r of rows) {
  const bodies = r.letterBodies.filter((b) => b.length > 0);
  if (bodies.length < 2) continue;
  const seen = new Set(contentLines(bodies[0]));
  let lines = 0;
  let dup = 0;
  for (const b of bodies.slice(1)) {
    for (const l of contentLines(b)) {
      lines++;
      if (seen.has(l)) dup++;
      seen.add(l);
    }
  }
  sibLines += lines;
  sibDup += dup;
  if (lines) sibTicks.push({ r, lines, dup });
}
console.log("\n## Второе письмо в такте: повторяет ли первое\n");
console.log(
  `- тактов, где сравнивать есть что (2+ письма с прочитанным телом): ${sibTicks.length}; строк во вторых и последующих письмах: ${sibLines}, из них дословно из первого: **${sibDup} (${pct(sibDup, sibLines)})**;`,
);

const allBodies = rows.flatMap((r) => r.letterBodies).filter((b) => b.length > 0);
let fact = 0;
let plain = 0;
for (const b of allBodies) {
  for (const raw of b.split("\n")) {
    if (normLine(raw).length < 40) continue;
    if (factual(raw)) fact++;
    else plain++;
  }
}
console.log(
  `- фактическая плотность писем: строк с числом/идентификатором/ссылкой ${fact}, строк чистой прозы ${plain} — ядро занимает ${pct(fact, fact + plain)} содержательных строк, а не десятую часть;`,
);

// --- повторы: сколько текста письма уже стояло в этом же треде выше ---
const dumps = flag("threads", null);
if (dumps) {
  const norm = normLine;
  const repeats = [];
  for (const file of readdirSync(dumps).filter((f) => f.endsWith(".txt"))) {
    const text = readFileSync(join(dumps, file), "utf8");
    const parts = text.split(/^## (msg-\d+) · from: ([\w-]+) · ([\d-]+)/m);
    const seen = new Set();
    for (let i = 1; i + 2 < parts.length; i += 4) {
      const [id, from, date, body] = [parts[i], parts[i + 1], parts[i + 2], parts[i + 3] ?? ""];
      const lines = body
        .split("\n")
        .map(norm)
        .filter((l) => l.length >= 40);
      if (!lines.length) continue;
      const dup = lines.filter((l) => seen.has(l)).length;
      for (const l of lines) seen.add(l);
      repeats.push({
        file: file.replace(".txt", ""),
        id,
        from,
        date,
        chars: body.length,
        lines: lines.length,
        dup,
      });
    }
  }
  const today = repeats.filter((r) => r.date >= SINCE);
  const dupShare = (rs) => pct(sum(rs.map((r) => r.dup)), sum(rs.map((r) => r.lines)));
  console.log("\n## Повторы внутри треда (строки ≥40 знаков, дословно уже стоявшие выше)\n");
  console.log(
    `- сообщений в выборке: ${today.length}; доля повторных строк: **${dupShare(today)}**;`,
  );
  for (const who of ["curator", "dev-core", "pilot-codex"]) {
    const rs = today.filter((r) => r.from === who);
    if (rs.length)
      console.log(
        `- ${who}: сообщений ${rs.length}, повторных строк ${dupShare(rs)}, медиана длины ${med(rs.map((r) => r.chars))} знаков;`,
      );
  }
  console.log("\n| тред | сообщение | автор | знаков | строк | из них повтор |");
  console.log("| --- | --- | --- | ---: | ---: | ---: |");
  for (const r of today.sort((a, b) => b.dup - a.dup).slice(0, 12))
    console.log(
      `| ${r.file} | ${r.id} | ${r.from} | ${r.chars} | ${r.lines} | ${r.dup} (${pct(r.dup, r.lines)}) |`,
    );
}

console.log("\n## Самые длинные письма\n");
console.log("| знаков | роль | тред | такт, мин |");
console.log("| --- | --- | --- | ---: |");
const longest = rows
  .flatMap((r) => r.letterSizes.map((n) => ({ n, r })))
  .sort((a, b) => b.n - a.n)
  .slice(0, 12);
for (const { n, r } of longest) console.log(`| ${n} | ${r.role} | ${r.thread} | ${f1(r.durMin)} |`);
