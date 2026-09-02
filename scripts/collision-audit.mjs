#!/usr/bin/env node
/**
 * ЗАМЕР СТОЛКНОВЕНИЙ — сколько раз две живые работы контура реально помешали друг другу.
 *
 * Считает не «сколько ожиданий было бы безопасно» (гипотетика), а фактические события:
 *   1. окна двух PR пересеклись по времени И их диффы пересеклись по путям;
 *   2. головы этих двух веток НЕ сливаются друг с другом чисто (`git merge-tree`) — то есть две
 *      работы стояли в одном ТЕКСТЕ, а не просто в одном файле;
 *   3. второй PR перебазирован поверх первого (squash первого — предок головы второго): круг ревью
 *      и прогон CI второму пришлось платить заново;
 *   4. окна пересеклись на ИСКЛЮЧИТЕЛЬНОМ ресурсе (номер схемы, `agent-protocol.json`, воркфлоу,
 *      замок зависимостей, версия пакета) — там пересечение не неудобство, а падение контура.
 *
 * Источники — только то, что контур пишет сам:
 *   - `gh pr list` — окно работы (создание PR … merge) и тред из шапки описания;
 *   - squash-коммит на `main` — множество путей PR;
 *   - `refs/remotes/pull/<N>` — ГОЛОВА ветки как она была; без неё виден файл, но не текст;
 *   - `.orchestrator/journal.jsonl` — отказы подъёма (класс «грязь общего рабочего места»).
 *
 * Головы веток притягиваются один раз перед запуском:
 *   git fetch origin '+refs/pull/*<slash>head:refs/remotes/pull/*'
 *
 * Запуск: node scripts/collision-audit.mjs [--repo <путь>] [--since 2026-08-18] [--home <.orchestrator>]
 * Печатает markdown-отчёт. Ничего не пишет и ничего не отправляет.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const REPO = flag("repo", process.cwd());
const SINCE = Date.parse(`${flag("since", "2026-08-18")}T00:00:00Z`);
const HOME = flag("home", join(REPO, ".orchestrator"));

/** Исключительные ресурсы: пересечение здесь — конфликт независимо от текста. */
const EXCLUSIVE = [
  [/^packages\/[^/]+\/src\/schema\/(version|migrate)\.ts$/, "номер схемы"],
  [/^agent-protocol\.json$/, "конфиг контура"],
  [/^\.github\/workflows\//, "воркфлоу"],
  [/^pnpm-lock\.yaml$/, "замок зависимостей"],
  [/^(packages\/[^/]+\/)?package\.json$/, "версия пакета"],
];
const exclusiveOf = (file) => EXCLUSIVE.find(([re]) => re.test(file))?.[1] ?? null;

const git = (args) =>
  execFileSync("git", args, { cwd: REPO, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
const gitOk = (args) => {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
};

/** PR из `gh`: окно работы и тред из шапки описания (`thread: NNN-slug`). */
function readPullRequests() {
  const raw = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,body,createdAt,mergedAt,closedAt,state",
    ],
    { cwd: REPO, maxBuffer: 1 << 28 },
  ).toString();
  return JSON.parse(raw).map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    thread: /thread:\s*(\d{3})/i.exec(p.body ?? "")?.[1] ?? null,
    from: Date.parse(p.createdAt),
    to: p.mergedAt ? Date.parse(p.mergedAt) : null,
    closedAt: p.closedAt ? Date.parse(p.closedAt) : null,
  }));
}

/** Пути PR — из его squash-коммита на `main`; ключ — номер в хвосте заголовка. */
function readSquashCommits() {
  const byPr = new Map();
  for (const line of git(["log", "origin/main", "--format=%H|%cI|%s"]).split("\n")) {
    const [sha, ts, ...rest] = line.split("|");
    const subject = rest.join("|");
    const n = /\(#(\d+)\)\s*$/.exec(subject);
    if (!n || byPr.has(Number(n[1]))) continue; // первая (самая новая) запись номера — его merge
    const files = git(["show", "--pretty=format:", "--name-only", sha]).split("\n").filter(Boolean);
    byPr.set(Number(n[1]), { sha, ts, subject, files });
  }
  return byPr;
}

/** Отказы подъёма из журнала: класс «общее рабочее место» виден здесь или нигде. */
function readLaunchRefusals() {
  const path = join(HOME, "journal.jsonl");
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("launch-refused")) continue;
    try {
      const d = JSON.parse(line);
      if (d.kind === "launch-refused" && Date.parse(d.ts) >= SINCE) out.push(d);
    } catch {
      /* строка журнала нечитаема — она не факт о столкновении */
    }
  }
  return out;
}

function analyse() {
  const byPr = readSquashCommits();
  const prs = readPullRequests();
  const works = prs
    .filter((p) => p.to !== null && p.from >= SINCE && byPr.has(p.number))
    .map((p) => ({ ...p, ...byPr.get(p.number), files: byPr.get(p.number).files }))
    .sort((a, b) => a.from - b.from);
  for (const w of works)
    w.head = gitOk(["rev-parse", `refs/remotes/pull/${w.number}`])
      ? git(["rev-parse", `refs/remotes/pull/${w.number}`])
      : null;

  let overlapping = 0;
  const pairs = [];
  for (let i = 0; i < works.length; i++) {
    for (let j = i + 1; j < works.length; j++) {
      const a = works[i];
      const b = works[j];
      if (!(a.from < b.to && b.from < a.to)) continue; // окна не пересеклись — не пара
      overlapping++;
      const common = a.files.filter((f) => b.files.includes(f));
      if (common.length === 0) continue;
      const first = a.to <= b.to ? a : b;
      const second = first === a ? b : a;
      const pair = {
        a,
        b,
        common,
        exclusive: [...new Set(common.map(exclusiveOf).filter(Boolean))],
        // перебазировка: squash первого стал предком головы второго
        rebased:
          Boolean(first.head && second.head) &&
          gitOk(["merge-base", "--is-ancestor", first.sha, second.head]),
        // текстовое столкновение: головы веток не сливаются друг с другом чисто
        conflict:
          Boolean(a.head && b.head) && !gitOk(["merge-tree", "--write-tree", a.head, b.head]),
        headless: !a.head || !b.head,
      };
      pairs.push(pair);
    }
  }
  return { works, overlapping, pairs, refusals: readLaunchRefusals(), prs };
}

const fmt = (ms) => new Date(ms).toISOString().slice(5, 16).replace("T", " ");
const name = (w) => `#${w.number}${w.thread ? ` (тред ${w.thread})` : ""}`;

const { works, overlapping, pairs, refusals, prs } = analyse();
const intersecting = pairs.length;
const conflicts = pairs.filter((p) => p.conflict);
const rebases = pairs.filter((p) => p.rebased);
const exclusive = pairs.filter((p) => p.exclusive.length > 0);
const crossThread = (list) => list.filter((p) => p.a.thread !== p.b.thread);

const lines = [];
lines.push("# Замер столкновений — что именно мешало друг другу");
lines.push("");
lines.push(`Выборка: ${works.length} влитых PR с ${new Date(SINCE).toISOString().slice(0, 10)}.`);
lines.push(
  `Пар с пересечением окон: **${overlapping}**; из них по путям пересеклись **${intersecting}**;` +
    ` текстом — **${conflicts.length}** (из них между РАЗНЫМИ тредами ${crossThread(conflicts).length});` +
    ` перебазировок поверх соседа — **${rebases.length}**;` +
    ` пересечений по исключительному ресурсу — **${exclusive.length}**.`,
);
const headless = pairs.filter((p) => p.headless).length;
if (headless > 0) lines.push(`Пар без головы ветки (текст не проверен): ${headless}.`);
lines.push("");
lines.push("## Текстовые столкновения");
lines.push("");
lines.push("| A | окно A | B | окно B | перебазирован | общие пути |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const p of conflicts) {
  lines.push(
    `| ${name(p.a)} | ${fmt(p.a.from)}→${fmt(p.a.to)} | ${name(p.b)} | ${fmt(p.b.from)}→${fmt(p.b.to)} |` +
      ` ${p.rebased ? "да" : "нет"} | ${p.common.join(", ")} |`,
  );
}
lines.push("");
lines.push("## Исключительные ресурсы");
lines.push("");
if (exclusive.length === 0) lines.push("Пересечений не найдено.");
for (const p of exclusive) {
  lines.push(
    `- ${name(p.a)} × ${name(p.b)} — ${p.exclusive.join(", ")}` +
      ` (${p.common.filter((f) => exclusiveOf(f)).join(", ")}), текст: ${p.conflict ? "конфликт" : "чисто"}`,
  );
}
lines.push("");
lines.push("## Отказы подъёма из журнала");
lines.push("");
const byReason = new Map();
for (const r of refusals) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
lines.push(
  byReason.size === 0
    ? "Отказов нет."
    : [...byReason].map(([reason, n]) => `- \`${reason}\` — ${n}`).join("\n"),
);
lines.push("");
lines.push("## PR, закрытые без merge");
lines.push("");
for (const p of prs.filter((p) => !p.to && p.state === "CLOSED" && p.from >= SINCE)) {
  lines.push(`- #${p.number} ${fmt(p.from)}→${fmt(p.closedAt)} — ${p.title}`);
}
console.log(lines.join("\n"));
