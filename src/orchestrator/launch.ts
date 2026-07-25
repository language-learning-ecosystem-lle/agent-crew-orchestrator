/**
 * Запуск роли сессией — ядро шага S1 (тред 012). Чистая часть: КОГО можно
 * запустить, КАКИМ промптом и МОЖНО ли прямо сейчас (потолки). Сам спавн
 * `claude -p` и запись в журнал — в CLI над этим (там, где IO).
 *
 * Три требования curator (тред 012, msg 14:15) закрыты здесь по построению:
 *  1. промпт собирается из `instructions` роли — `buildLaunchPrompt`, никакого
 *     «role → вот этот файл» в коде;
 *  2. запись в журнал ДО спавна — `planLaunch` возвращает события
 *     `lease-acquired`+`launch`, которые CLI пишет ПЕРЕД стартом процесса;
 *  3. один тред за прогон — и решение, и промпт берут ровно один `thread`.
 *
 * Потолок — двумя слоями (оба против «запуск→обрыв→запуск съел квоту»):
 *  - на связку (role, thread): переиспользуем `exhausted` из S0 — три обрыва и
 *    больше не пытаемся;
 *  - глобальный: `consecutiveLaunchesWithoutCompletion` под авто-цикл S3 —
 *    launch'ей подряд без единого `completed` не больше `MAX_CONSECUTIVE_RUNS`.
 */
import type { Launch, Role } from "../roles/schema.js";
import { eventTimestamp, type OrchestratorEvent } from "./journal.js";
import { foldLeases } from "./lease.js";

/**
 * Потолок глобального авто-цикла: сколько прогонов подряд БЕЗ единого успешного
 * завершения оркестратор вправе запустить, прежде чем упереться и позвать
 * человека (требование curator). Здоровая система завершает прогоны; пачка
 * launch'ей без `completed` — это и есть петля обрыва, жгущая квоту. Калибруемо.
 */
export const MAX_CONSECUTIVE_RUNS = 10;

/** Почему роль НЕ запускается оркестратором — машинно, не «claude.ai» глазами. */
export type LaunchBlock =
  | "inactive"
  | "wake-not-watch"
  | "no-instructions"
  | "external-instructions"
  | "no-launch-profile";

export type Launchability = { launchable: true } | { launchable: false; reason: LaunchBlock };

/**
 * Может ли оркестратор запустить роль сессией. Решение берётся из МАШИННО
 * ЗНАЧИМЫХ полей (`status`, `wake`, `instructions[].kind`), а НЕ из `role.kind`:
 * тот — свободный проектный ярлык («claude.ai», «gh-action»), и пакет его не
 * интерпретирует (см. doc-блок схемы роли). Отсюда:
 *  - `wake.mode !== "watch"` — у роли нет своей сессии, которую мы поднимаем:
 *    john (`self`, человек), curator (`via-human`, оживает через человека),
 *    reviewer-pr/github (`event`, будит платформа) — не наши для спавна;
 *  - `instructions` пусты — промпт собирать не из чего (это dev-speech сегодня):
 *    честный отказ, а не падение на отсутствии файла;
 *  - `instructions` с `external` — карточка исполняется СНАРУЖИ (скилл на стороне
 *    чата), локальный `claude -p` ею управлять не должен (это curator).
 */
export const roleLaunchability = (role: Role): Launchability => {
  if (role.status !== "active") return { launchable: false, reason: "inactive" };
  if (role.wake.mode !== "watch") return { launchable: false, reason: "wake-not-watch" };
  const instructions = role.instructions ?? [];
  if (instructions.length === 0) return { launchable: false, reason: "no-instructions" };
  if (instructions.some((entry) => entry.kind === "external")) {
    return { launchable: false, reason: "external-instructions" };
  }
  // Профиль прав — часть контракта запуска: роль без него поднимать НЕЛЬЗЯ.
  // Первый боевой прогон показал, чем оборачивается его отсутствие: сессия
  // поднимается, живёт пять минут и выходит, ничего не записав, потому что
  // писать ей нечем. Умолчание было бы хуже отказа — «поднял с правами,
  // которых никто не назначал».
  if (role.launch === undefined) return { launchable: false, reason: "no-launch-profile" };
  return { launchable: true };
};

/**
 * Аргументы запуска сессии — ОДНО место, где они собираются, и оно закреплено
 * тестом (требование 4 curator). Спайк P0 звал агента с `--allowedTools` и
 * оставался зелёным, пока код регрессировал: argv не был прибит ничем, и
 * полномочия выпали из контракта незаметно. Пока список аргументов живёт
 * выражением внутри спавна, он выпадет снова тем же способом.
 */
export const buildLaunchArgv = (input: {
  readonly prompt: string;
  readonly maxTurns: string;
  readonly launch: Launch;
}): string[] => [
  "-p",
  input.prompt,
  "--allowedTools",
  input.launch.allowedTools.join(","),
  "--max-turns",
  input.maxTurns,
];

/** Полномочия роли одной строкой — для витрины `status` и вывода запуска. */
export const describeLaunch = (role: Role): string => {
  const profile = role.launch;
  if (profile === undefined) {
    const why = roleLaunchability(role);
    return why.launchable
      ? `${role.id}: профиля запуска нет`
      : `${role.id}: не запускается контуром (${why.reason})`;
  }
  return `${role.id}: ${profile.allowedTools.join(", ")}`;
};

export type InstructionDoc = { readonly path: string; readonly text: string };

/**
 * Промпт для `claude -p` — из карточки роли (её `instructions`) и ОДНОГО треда.
 * Чистая: тексты инструкций уже прочитаны снаружи. «Только по этому треду» —
 * жёстко в промпте: признак завершения S2 привязан к переходу хода по нему, и
 * если прогон разберёт всю почту, критерий размажется (требование 3 curator).
 */
export const buildLaunchPrompt = (input: {
  readonly role: string;
  readonly thread: string;
  readonly instructions: readonly InstructionDoc[];
}): string => {
  const cards = input.instructions.map((doc) => `# ${doc.path}\n\n${doc.text}`).join("\n\n---\n\n");
  return [
    `Ты — роль \`${input.role}\` протокола agent-comms. Твоя карточка роли — ниже.`,
    "",
    `Ход передан тебе по треду \`${input.thread}\` — И ТОЛЬКО ПО НЕМУ. Остальную свою почту НЕ разбирай: этот прогон закреплён ровно за одним тредом.`,
    "",
    "Прочитай тред целиком (включая файлы папки разговора), отработай постановку и ответь сообщением в конец треда по правилам протокола (`cli new-message`). Когда ответ записан и ход передан дальше — прогон закончен.",
    "",
    "--- КАРТОЧКА РОЛИ ---",
    "",
    cards,
  ].join("\n");
};

/**
 * Launch'ей подряд без единого `completed`. Каждый `launch` увеличивает счётчик,
 * успешный `lease-released reason=completed` обнуляет его. Петля «запуск→обрыв»
 * (releases с timeout/forced, но не completed) копится — на этом её и ловим.
 */
export const consecutiveLaunchesWithoutCompletion = (
  events: readonly OrchestratorEvent[],
): number => {
  let count = 0;
  for (const event of events) {
    if (event.kind === "launch") count += 1;
    else if (event.kind === "lease-released" && event.reason === "completed") count = 0;
  }
  return count;
};

export type LaunchRefusal = "already-running" | "exhausted" | "run-budget";

export type LaunchPlan =
  | { readonly ok: true; readonly deadline: string; readonly events: readonly OrchestratorEvent[] }
  | { readonly ok: false; readonly reason: LaunchRefusal };

/**
 * Решение о запуске + события ДО спавна. Отказ, если:
 *  - связка уже активна (`running`/`draining`) — не плодим второй прогон;
 *  - связка `exhausted` — потолок попыток на (role, thread) достигнут;
 *  - глобальный потолок прогонов без завершения исчерпан.
 * Иначе — `lease-acquired` (с материализованным `deadline`) + `launch`.
 */
export const planLaunch = (input: {
  readonly events: readonly OrchestratorEvent[];
  readonly role: string;
  readonly thread: string;
  readonly now: Date;
  readonly wallClockMs: number;
  readonly maxConsecutive?: number;
}): LaunchPlan => {
  const { events, role, thread, now, wallClockMs } = input;
  const maxConsecutive = input.maxConsecutive ?? MAX_CONSECUTIVE_RUNS;

  const view = foldLeases(events, now).find((v) => v.role === role && v.thread === thread);
  if (view && (view.state === "running" || view.state === "draining")) {
    return { ok: false, reason: "already-running" };
  }
  if (view?.exhausted) return { ok: false, reason: "exhausted" };
  if (consecutiveLaunchesWithoutCompletion(events) >= maxConsecutive) {
    return { ok: false, reason: "run-budget" };
  }

  const ts = eventTimestamp(now);
  const deadline = eventTimestamp(new Date(now.getTime() + wallClockMs));
  const events2: OrchestratorEvent[] = [
    { kind: "lease-acquired", ts, role, thread, deadline },
    { kind: "launch", ts, role, thread },
  ];
  return { ok: true, deadline, events: events2 };
};
