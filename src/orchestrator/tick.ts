/**
 * Решение одного тика демона — чистое ядро шага S3 (тред 012). До S3 цикл
 * замыкал человек; здесь оркестратор решает сам, поэтому дизайн — вокруг «что
 * если никто не смотрит».
 *
 * Три требования curator (msg 15:25) закрыты здесь по построению:
 *  1. глобальный потолок ПИШЕТСЯ в журнал: `run-budget` исчерпан → решение
 *     `refused`, демон оставляет след `launch-refused` (не жжёт квоту молча);
 *  2. стартовое состояние ВЫКЛЮЧЕНО: `enabled=false` → `disabled`, ни одного
 *     запуска; первый автономный запуск не произойдёт случайно;
 *  3. аварийный тормоз: `stopped=true` (файл-флаг стопа) → `halt`, перекрывает
 *     включение; проверяется ПЕРЕД каждым запуском.
 *
 * Один тик = одно решение = максимум один запуск: демон поднимает пару, ждёт её
 * терминала (наблюдатель S2) и тикает заново. Так потолок и аренды считаются по
 * свежему журналу, без гонок внутри тика.
 *
 * S5 добавил четвёртый гард — `held`: роль, занятая ЖИВОЙ РУЧНОЙ СЕССИЕЙ, из
 * кандидатов выбывает, иначе демон поднял бы вторую сессию той же роли поверх
 * работающей (постановка curator 20:25). Устройство holdʼа — `hold.ts`.
 */

import type { OrchestratorEvent, RefusalReason } from "./journal.js";
import { consecutiveLaunchesWithoutCompletion, MAX_CONSECUTIVE_RUNS } from "./launch.js";
import { foldLeases } from "./lease.js";

/** Пара «роль ждёт на треде» — кандидат на запуск (из `threadsWaitingOn`). */
export type Candidate = { readonly role: string; readonly thread: string };

export type TickDecision =
  | { readonly kind: "halt" } // стоп-флаг — аварийный тормоз
  | { readonly kind: "disabled" } // выключено (нет флага включения)
  | { readonly kind: "idle" } // нечего запускать
  // Единственные кандидаты — за ролями, занятыми ручными сессиями (S5). Это НЕ
  // idle: «нечего делать» и «есть что делать, но роль у человека» — разные
  // состояния контура, и второе обязано быть видно, иначе забытый hold выглядит
  // как тишина в почте.
  | { readonly kind: "held"; readonly roles: readonly string[] }
  | { readonly kind: "launch"; readonly role: string; readonly thread: string }
  | {
      readonly kind: "refused";
      readonly role: string;
      readonly thread: string;
      readonly reason: RefusalReason;
    };

export const planTick = (input: {
  readonly enabled: boolean;
  readonly stopped: boolean;
  readonly events: readonly OrchestratorEvent[];
  readonly candidates: readonly Candidate[];
  readonly now: Date;
  readonly maxConsecutive?: number;
  /** Роли, занятые ручными сессиями прямо сейчас (S5, `heldRoles`). */
  readonly held?: readonly string[];
}): TickDecision => {
  const maxConsecutive = input.maxConsecutive ?? MAX_CONSECUTIVE_RUNS;
  const held = input.held ?? [];

  // Тормоз и выключение — ДО любого решения о запуске (требования 2 и 3). Стоп
  // перекрывает включение: аварийная остановка не спорит с состоянием.
  if (input.stopped) return { kind: "halt" };
  if (!input.enabled) return { kind: "disabled" };

  // Занятые человеком роли выбывают ЦЕЛИКОМ, а не по связке: hold держит роль,
  // а не тред — ручная сессия dev-core занята собой на любом треде. Остальные
  // роли при этом запускаются как обычно, поэтому фильтр здесь, а не выход.
  const free = input.candidates.filter((candidate) => !held.includes(candidate.role));
  const blocked = input.candidates.filter((candidate) => held.includes(candidate.role));

  // Первый кандидат, которого можно запускать: связка не активна и не исчерпана.
  // (Исчерпание уже в журнале своими release'ами — отдельным следом не спамим.)
  const views = foldLeases(input.events, input.now);
  const eligible = free.find((candidate) => {
    const view = views.find((v) => v.role === candidate.role && v.thread === candidate.thread);
    if (view && (view.state === "running" || view.state === "draining")) return false;
    if (view?.exhausted) return false;
    return true;
  });
  if (eligible === undefined) {
    // Запускать нечего — но ПОЧЕМУ, зависит от holdʼов: если работа была и её
    // держит человек, тик говорит это вслух.
    const heldWithWork = [...new Set(blocked.map((candidate) => candidate.role))];
    return heldWithWork.length === 0 ? { kind: "idle" } : { kind: "held", roles: heldWithWork };
  }

  // Глобальный потолок — со следом (требование 1): исчерпан → отказ, а не запуск.
  if (consecutiveLaunchesWithoutCompletion(input.events) >= maxConsecutive) {
    return { kind: "refused", role: eligible.role, thread: eligible.thread, reason: "run-budget" };
  }
  return { kind: "launch", role: eligible.role, thread: eligible.thread };
};
