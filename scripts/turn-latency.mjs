#!/usr/bin/env node
// Оборот хода: сколько переданный ход ждёт, пока роль его поднимет, и сколько
// этого ожидания роль ЗАНЯТА другим тредом. Замер треда 066 (тогда — рукой,
// «скрипта под это нет»); тред 177 меряет им же «до» и «после» подъёма потолка
// пар на роль, поэтому команда обязана быть одна и та же на обоих концах.
//
//   node scripts/turn-latency.mjs [--journal <p>] [--since <iso>] [--until <iso>] [--json]
//
// Источник — журнал оркестратора (`.orchestrator/journal.jsonl`), а не почта:
// `handoff-detected` пишется тактом, увидевшим переданный ход, `lease-acquired` —
// подъёмом пары. ГРАНИЦА ЗАМЕРА, и она печатается вместе с числами:
//   * левый край — момент, когда ход УВИДЕЛ демон, а не момент письма: замер
//     занижен на неполный такт планировщика;
//   * ожидание меряет ДОСТУПНОСТЬ РОЛИ, а не готовность треда — запаркованный
//     на CI тред ждал бы и так (та же оговорка, что в 066);
//   * ход, не поднятый ни разу до правого края окна, в медиану НЕ входит и
//     печатается отдельной строкой `never lifted`, а не молчит.

import { readFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const journalPath = path.resolve(
  flag("--journal", path.join(process.cwd(), ".orchestrator", "journal.jsonl")),
);
const sinceArg = flag("--since", undefined);
const untilArg = flag("--until", undefined);
const asJson = argv.includes("--json");

const ms = (iso) => Date.parse(iso);
const parseEdge = (name, value) => {
  if (value === undefined) return undefined;
  const t = ms(value);
  if (Number.isNaN(t)) {
    console.error(`turn-latency: ${name} is not an ISO instant — '${value}'`);
    process.exit(2);
  }
  return t;
};
const since = parseEdge("--since", sinceArg);
const until = parseEdge("--until", untilArg);

let raw;
try {
  raw = readFileSync(journalPath, "utf8");
} catch (err) {
  console.error(`turn-latency: the journal cannot be read — ${journalPath}: ${err.message}`);
  process.exit(2);
}

const events = [];
let unparsed = 0;
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  try {
    events.push(JSON.parse(line));
  } catch {
    unparsed += 1;
  }
}

const acquired = events.filter((e) => e.kind === "lease-acquired" && e.role && e.thread);
const released = events.filter((e) => e.kind === "lease-released" && e.role && e.thread);
const handoffs = events.filter((e) => e.kind === "handoff-detected" && e.role && e.thread);

// Аренда без своего `lease-released` — ротированный журнал или живой прогон:
// пролёт закрывается правым краем окна, и число таких пролётов печатается.
const rightEdge = until ?? Math.max(...events.map((e) => ms(e.ts)).filter((t) => !Number.isNaN(t)));
let openSpans = 0;
const spans = acquired.map((a) => {
  const from = ms(a.ts);
  const rel = released.find((r) => r.role === a.role && r.thread === a.thread && ms(r.ts) >= from);
  if (!rel) openSpans += 1;
  return { role: a.role, thread: a.thread, from, to: rel ? ms(rel.ts) : rightEdge };
});

const inWindow = (t) => (since === undefined || t >= since) && (until === undefined || t <= until);

const waits = [];
let neverLifted = 0;
for (const h of handoffs) {
  const at = ms(h.ts);
  if (!inWindow(at)) continue;
  const lift = acquired.find((a) => a.role === h.role && a.thread === h.thread && ms(a.ts) >= at);
  if (!lift) {
    neverLifted += 1;
    continue;
  }
  const waitedMin = (ms(lift.ts) - at) / 60_000;
  let busyMin = 0;
  for (const s of spans) {
    if (s.role !== h.role || s.thread === h.thread) continue;
    const overlap = Math.min(s.to, ms(lift.ts)) - Math.max(s.from, at);
    if (overlap > 0) busyMin += overlap / 60_000;
  }
  waits.push({
    role: h.role,
    thread: h.thread,
    at: h.ts,
    waitedMin,
    busyMin: Math.min(busyMin, waitedMin),
  });
}

const quantile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
};
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

const minutes = waits.map((w) => w.waitedMin);
const waitedTotal = minutes.reduce((a, b) => a + b, 0);
const busyTotal = waits.reduce((a, b) => a + b.busyMin, 0);
const busyWaits = waits.filter((w) => w.busyMin > 0.5).map((w) => w.waitedMin);

const report = {
  journal: journalPath,
  window: {
    since: sinceArg ?? "the earliest event in the journal",
    until: untilArg ?? "the latest event in the journal",
  },
  handoffs: waits.length,
  neverLifted,
  medianMin: round1(quantile(minutes, 0.5)),
  p75Min: round1(quantile(minutes, 0.75)),
  p90Min: round1(quantile(minutes, 0.9)),
  waitedHours: round1(waitedTotal / 60),
  busyHours: round1(busyTotal / 60),
  busySharePct: waitedTotal === 0 ? null : round1((busyTotal / waitedTotal) * 100),
  waitsWithBusy: busyWaits.length,
  medianMinWhereBusy: round1(quantile(busyWaits, 0.5)),
  openLeaseSpans: openSpans,
  unparsedLines: unparsed,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`turn-latency: journal ${report.journal}`);
  console.log(`turn-latency: window ${report.window.since} … ${report.window.until}`);
  console.log(
    `turn-latency: ${report.handoffs} handoff(s) lifted — median ${report.medianMin}m, p75 ${report.p75Min}m, p90 ${report.p90Min}m`,
  );
  console.log(
    `turn-latency: of ${report.waitedHours}h waited, ${report.busyHours}h (${report.busySharePct} %) the role was BUSY on another thread`,
  );
  console.log(
    `turn-latency: where the role was busy at all — ${report.waitsWithBusy} handoff(s), median ${report.medianMinWhereBusy}m`,
  );
  console.log(
    `turn-latency: ${report.neverLifted} handoff(s) never lifted inside the window — NOT in the median above`,
  );
  if (report.openLeaseSpans > 0) {
    console.log(
      `turn-latency: ${report.openLeaseSpans} lease(s) have no 'lease-released' (rotated journal or a live run) — closed at the right edge, so the busy share is a LOWER bound`,
    );
  }
  if (report.unparsedLines > 0) {
    console.log(`turn-latency: ${report.unparsedLines} journal line(s) could not be parsed`);
  }
  console.log(
    "turn-latency: the left edge is when the DAEMON saw the handoff, not when the letter landed; and the wait measures the availability of the ROLE, not the readiness of the thread",
  );
}
