/**
 * Наблюдатель за прогоном — чистое ядро шага S2 (тред 012). Ключевое: оркестратор
 * НЕ останавливает агента. Агент завершается САМ, дописав ответ и передав ход;
 * наблюдатель лишь распознаёт исход и переводит аренду running → draining →
 * stopped СО СЛЕДОМ. Агент о своей остановке не знает и знать не должен
 * (требование 3 curator) — поэтому здесь нет и не может быть «сказать агенту».
 *
 * Признак завершения — ПЕРЕХОД ХОДА по треду, под который взята аренда
 * (требование 1): не «код 0» (процесс мог выйти, не записав ответа) и не «почта
 * опустела» (могла опустеть чужой правкой). `handedOff` считается снаружи из
 * `threadsWaitingOn` по ИСТОЧНИКУ-тредам и приходит сюда булевом.
 *
 * `handedOff` проверяется РАНЬШЕ `overdue`: переход хода — это успех, и заметить
 * его на дедлайне или чуть позже не значит объявить таймаут. `overdue` бьёт лишь
 * там, где ход НЕ перешёл, — тогда дедлайн аренды и есть предел `draining`
 * (требование 2): «остановится по завершении» не превращается в «не остановится
 * никогда».
 */
import type { OrchestratorEvent } from "./journal.js";

export type Lifecycle = "running" | "draining";

export type ObserveSignals = {
  /** Тред больше НЕ ждёт роль — ход перешёл (из threadsWaitingOn). */
  readonly handedOff: boolean;
  /** Процесс сессии завершился (сам или убит). */
  readonly processExited: boolean;
  /** now > deadline аренды. */
  readonly overdue: boolean;
};

/** Что записать следующим шагом (или null — продолжать наблюдать). */
export type ObserveStep =
  | { readonly record: "handoff-detected" }
  | {
      readonly record: "lease-released";
      readonly reason: "completed" | "timeout" | "exited-without-handoff";
    }
  | null;

/**
 * Перешёл ли ход — по СОСТОЯНИЮ ПОЧТЫ. Отдельная функция, а не выражение в
 * оболочке, ровно по одной причине: это самая опасная ветка изоляции сбойных
 * тредов, и ей нужен собственный тест (замечание reviewer-pr к PR #5).
 *
 * Тред под арендой ЖДАЛ роль; перестал ждать — ход передан. Но «перестал ждать»
 * и «не смогли прочитать» — разные вещи, а по списку ожидающих они выглядят
 * одинаково: нечитаемого треда в списке нет. Считать это переходом хода значило
 * бы закрыть прогон как `completed`, хотя роль не ответила ни строчки, — то есть
 * сломанный файл почты тихо подделал бы результат приёмки. Поэтому нечитаемость
 * СВОЕГО треда — неизвестность: наблюдаем дальше, предел ставит дедлайн.
 */
export const handoffDetected = (input: {
  /** Тред, под который взята аренда, не разобрался в этом обходе. */
  readonly threadUnreadable: boolean;
  /** Треды, ожидающие роль СЕЙЧАС (из `threadsWaitingOn` по читаемым). */
  readonly waitingThreads: readonly string[];
  /** Тред, под который взята аренда. */
  readonly thread: string;
}): boolean => !input.threadUnreadable && !input.waitingThreads.includes(input.thread);

export const observeStep = (lifecycle: Lifecycle, signals: ObserveSignals): ObserveStep => {
  if (lifecycle === "running") {
    // Ход перешёл — в draining, процесс НЕ трогаем: завершится сам (требование 3).
    if (signals.handedOff) return { record: "handoff-detected" };
    // Дедлайн без перехода хода — застрял: предел draining/running (требование 2).
    if (signals.overdue) return { record: "lease-released", reason: "timeout" };
    // Процесс вышел САМ, хода не передав, до дедлайна — вышел, не сделав дело.
    // Причина СВОЯ, не `forced`: форс — это внешнее решение человека со следом
    // `by`, а здесь никто ничего не решал, сессия просто кончилась. Одно имя на
    // оба случая делало журнал прибором, который врёт в сценарии приёмки 3
    // (постановка curator 20:55).
    if (signals.processExited) {
      return { record: "lease-released", reason: "exited-without-handoff" };
    }
    return null;
  }

  // draining: ход уже перешёл (успех решён). Закрываем по выходу процесса; если
  // процесс залип за дедлайн — всё равно completed (дело сделано), CLI его гасит.
  if (signals.processExited) return { record: "lease-released", reason: "completed" };
  if (signals.overdue) return { record: "lease-released", reason: "completed" };
  return null;
};

/** Событие journal из шага наблюдателя — CLI проставляет ts/role/thread. */
export const stepEvent = (
  step: Exclude<ObserveStep, null>,
  base: { readonly ts: string; readonly role: string; readonly thread: string },
): OrchestratorEvent =>
  step.record === "handoff-detected"
    ? { kind: "handoff-detected", ...base }
    : { kind: "lease-released", ...base, reason: step.reason };
