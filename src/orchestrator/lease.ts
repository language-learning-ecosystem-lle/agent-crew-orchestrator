/**
 * Аренда — текущее оперативное состояние оркестратора, свёрнутое ИЗ журнала.
 * Шаг S0 (тред 012). Аренда не хранится отдельным мутируемым файлом: она —
 * проекция append-only журнала, `foldLeases(events, now)`. Тот же приём, что
 * `_thread.md`/`INDEX` в контуре — источник append-only, состояние поверх него
 * свёрткой, и разойтись двум писателям не на чем. Переживает рестарт демона
 * даром: журнал на диске, свёртка пересчитывается.
 *
 * Здесь закрыты оба пробела, названные curator (тред 012), — ПОЛЯМИ, не
 * поведением (спавна в S0 нет):
 *  - пробел 1 «работает vs повис»: `overdue` — аренда жива, а `deadline` уже
 *    прошёл. Видно в данных ДО всякого действия; снятие по таймауту — поведение
 *    S2/S4, но признак существует с S0.
 *  - пробел 2 «оборвался, а почта осталась»: `attempt` (число взятий аренды) и
 *    `exhausted` (attempt ≥ MAX_ATTEMPTS после неуспешного финала). Условие
 *    запуска S3 прочитает `launchable`, и бесконечного релонча не будет по
 *    построению.
 */
import { MAX_ATTEMPTS, type OrchestratorEvent, type ReleaseReason } from "./journal.js";

/** Жизненный цикл аренды. `released`/`stopped` терминальны (с `reason`/`mode`). */
export type LeaseLifecycle = "running" | "draining" | "released" | "stopped";

export type LeaseView = {
  readonly role: string;
  readonly thread: string;
  readonly state: LeaseLifecycle;
  /** Сколько раз аренда бралась на эту связку — счётчик потолка попыток. */
  readonly attempt: number;
  /** Wall-clock предел текущего/последнего прогона; null, если аренды ещё не было. */
  readonly deadline: string | null;
  /** Причина терминального состояния (release/stop), иначе null. */
  readonly reason: ReleaseReason | "graceful" | "forced" | null;
  /** Вид последнего события связки — для колонки «последнее» в status. */
  readonly lastEvent: OrchestratorEvent["kind"];
  /** Аренда жива, но `deadline` уже прошёл относительно `now`. */
  readonly overdue: boolean;
  /** Потолок попыток исчерпан — дальше не запускаем. */
  readonly exhausted: boolean;
  /** Связку МОЖНО запустить снова (неуспешный финал и потолок не достигнут). */
  readonly launchable: boolean;
};

// Ключ связки (role, thread) — через JSON, чтобы не изобретать разделитель:
// role/thread хранятся в аккумуляторе отдельно и обратно из ключа не разбираются.
const key = (role: string, thread: string): string => JSON.stringify([role, thread]);

/** Аренда активна (держится оркестратором прямо сейчас). */
const isActive = (state: LeaseLifecycle): boolean => state === "running" || state === "draining";

/** Терминальный НЕУСПЕХ: прогон оборван (таймаут/форс), не завершён штатно. */
const isFailedTerminal = (state: LeaseLifecycle, reason: LeaseView["reason"]): boolean =>
  !isActive(state) && (reason === "timeout" || reason === "forced");

type Acc = {
  role: string;
  thread: string;
  state: LeaseLifecycle;
  attempt: number;
  deadline: string | null;
  reason: LeaseView["reason"];
  lastEvent: OrchestratorEvent["kind"];
};

/**
 * Свёртка журнала в состояние аренды по каждой связке (role, thread). События
 * идут по порядку строк — единственный писатель, порядок по построению.
 */
export const foldLeases = (events: readonly OrchestratorEvent[], now: Date): LeaseView[] => {
  const acc = new Map<string, Acc>();
  const order: string[] = [];

  for (const event of events) {
    // Отказ от запуска аренды не создаёт — это не состояние сессии, а след
    // решения оркестратора. В свёртку аренд он не входит.
    if (event.kind === "launch-refused") continue;
    const k = key(event.role, event.thread);
    let cur = acc.get(k);
    if (cur === undefined) {
      cur = {
        role: event.role,
        thread: event.thread,
        state: "released",
        attempt: 0,
        deadline: null,
        reason: null,
        lastEvent: event.kind,
      };
      acc.set(k, cur);
      order.push(k);
    }
    cur.lastEvent = event.kind;

    switch (event.kind) {
      case "lease-acquired":
        cur.state = "running";
        cur.attempt += 1;
        cur.deadline = event.deadline;
        cur.reason = null;
        break;
      case "launch":
        // Процесс поднят; состояние аренды остаётся running.
        break;
      case "handoff-detected":
        // Ход ушёл с роли — сессия сворачивается.
        if (isActive(cur.state)) cur.state = "draining";
        break;
      case "lease-released":
        cur.state = "released";
        cur.reason = event.reason;
        break;
      case "stop":
        cur.state = "stopped";
        cur.reason = event.mode;
        break;
    }
  }

  const nowIso = `${now.toISOString().slice(0, 19)}Z`;
  return order.map((k) => {
    const cur = acc.get(k) as Acc;
    const overdue = isActive(cur.state) && cur.deadline !== null && nowIso > cur.deadline;
    const failed = isFailedTerminal(cur.state, cur.reason);
    const exhausted = cur.reason === "exhausted" || (failed && cur.attempt >= MAX_ATTEMPTS);
    const launchable = failed && !exhausted;
    return {
      role: cur.role,
      thread: cur.thread,
      state: cur.state,
      attempt: cur.attempt,
      deadline: cur.deadline,
      reason: cur.reason,
      lastEvent: cur.lastEvent,
      overdue,
      exhausted,
      launchable,
    };
  });
};
