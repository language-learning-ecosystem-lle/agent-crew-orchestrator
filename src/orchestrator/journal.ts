/**
 * Журнал оркестратора P3 — append-only лог того, ЧТО он сделал с сессиями ролей.
 * Шаг S0 (тред 012): данные прежде поведения. Здесь нет ни одного спавна —
 * только модель события и его запись/чтение; сам запуск сессий приходит с S1.
 *
 * Почему журнал первым (решение curator, тред 012): весь пакет строился так —
 * сначала наблюдаемость, потом рискованное действие. Спавн `claude -p` без
 * журнала диагностировался бы вслепую, ровно как контур до `derive`/`verify`.
 *
 * Журнал ЛОКАЛЬНЫЙ, не в git (развилка 3): состояние аренды транзиентно и в
 * истории `comms` ему не место. Файл — JSONL, ОДНО событие на строку: порядок
 * событий — это порядок строк единственного писателя (демона), а не результат
 * слияния веток, поэтому seq-компаратор мигрированных сообщений здесь не нужен —
 * append одного процесса уже даёт порядок по построению.
 *
 * КАЖДЫЙ ИСХОД СО СЛЕДОМ (урок 014): снятие аренды по ЛЮБОЙ причине — успех,
 * форс, таймаут, исчерпание попыток — это событие `lease-released` с полем
 * `reason`. Тихо повиснуть `draining` или тихо перестать пытаться нельзя: и то,
 * и другое обязано оставлять запись, иначе роль выпадает из системы незаметно
 * (два пробела, названные curator; закрыты в данных, не в исполнителе).
 */
import { z } from "zod";

/**
 * Потолок попыток на связку (role, thread). Прошлый прогон роли на треде мог
 * оборваться системно — мал лимит ходов, сломано окружение; тогда условие
 * запуска («роль ждёт, аренды нет») снова истинно, и без потолка следующий тик
 * запускал бы её вечно, жёг квоту (пробел 2, curator). Достигнут потолок —
 * связка `exhausted`, дальше не пытаемся, смотрим журнал.
 */
export const MAX_ATTEMPTS = 3;

/**
 * Причина снятия аренды. Терминальна всегда — аренда живёт до первого release.
 *
 * `forced` и `exited-without-handoff` РАЗДЕЛЕНЫ (постановка curator, тред 012,
 * 20:55): до этого процесс, вышедший сам и не передавший хода, писался как
 * `forced` — то есть падение сессии в журнале было неотличимо от остановки
 * john'ом. Сценарий приёмки «`force` оставляет след кто/когда/почему» на таком
 * приборе проходил бы одинаково и когда контур работает, и когда роль просто
 * рухнула. `forced` теперь означает ровно одно: был форс, и у него есть `by`.
 *
 * `forced` из перечня НЕ убран, хотя путь `lease-released` его больше не пишет
 * (реальный форс пишет событие `stop {mode: forced, by, note}`): журналы —
 * append-only файлы на диске, и удаление значения сделало бы НЕЧИТАЕМЫМИ старые
 * строки, а разбор у нас громкий. Прошлое перечнем не переписывают.
 */
export const RELEASE_REASONS = [
  "completed",
  "forced",
  "exited-without-handoff",
  "timeout",
  "exhausted",
] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

/**
 * Причина ОТКАЗА от запуска — событие `launch-refused` (S3). Оркестратор хотел
 * поднять пару (role, thread), но не стал, и отказ оставляет СЛЕД (иначе петля
 * «запуск→обрыв→запуск» жгла бы квоту молча — требование curator к S3). Сегодня
 * одна причина: глобальный потолок прогонов без завершения.
 */
export const REFUSAL_REASONS = ["run-budget"] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

const base = {
  /** UTC-метка события: `2026-07-24T13:45:12Z`. Проставляет писатель в момент записи. */
  ts: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "ts должен быть UTC ISO без миллисекунд"),
  role: z.string().min(1),
  thread: z.string().min(1),
};

/**
 * Событие журнала — дискриминированное объединение по `kind`. Обязательность
 * полей задаётся видом события, а не проверяется вручную: `lease-acquired` без
 * `deadline` или `lease-released` без `reason` не разберётся вовсе.
 */
export const orchestratorEventSchema = z.discriminatedUnion("kind", [
  // Оркестратор взял аренду на запуск роли по треду; `deadline` — материализованный
  // wall-clock предел прогона (развилка 2), по нему S2/S3 судят «повис ли», не
  // пересчитывая срок на месте.
  z.object({
    kind: z.literal("lease-acquired"),
    ...base,
    deadline: base.ts,
  }),
  // Сессия роли запущена процессом (наполняется с S1).
  z.object({ kind: z.literal("launch"), ...base }),
  // Ход ушёл с роли — сигнал завершения (наполняется с S2). Аренда → draining.
  z.object({ kind: z.literal("handoff-detected"), ...base }),
  // Аренда снята — ВСЕГДА с причиной (со следом).
  z.object({
    kind: z.literal("lease-released"),
    ...base,
    reason: z.enum(RELEASE_REASONS),
  }),
  // Сессия принудительно остановлена (S4). `by`/`note` — «кто» и «почему»,
  // вместе с `ts` («когда») дают самодостаточный след force'а в журнале. Для
  // `graceful` (демон дочитывает текущую сессию по стоп-флагу) они не обязательны.
  z.object({
    kind: z.literal("stop"),
    ...base,
    mode: z.enum(["graceful", "forced"]),
    by: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  }),
  // Оркестратор ОТКАЗАЛСЯ запускать пару (role, thread) — со следом (S3).
  z.object({
    kind: z.literal("launch-refused"),
    ...base,
    reason: z.enum(REFUSAL_REASONS),
  }),
]);

export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;
export type EventKind = OrchestratorEvent["kind"];

/** UTC-метка события из момента: `2026-07-24T13:45:12Z` (без миллисекунд). */
export const eventTimestamp = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

/** Событие → строка JSONL. Ключи в стабильном порядке — дифф журнала читаем. */
export const renderEventLine = (event: OrchestratorEvent): string => JSON.stringify(event);

/**
 * Строка JSONL → событие. Кривая строка — ГРОМКИЙ отказ, а не пропуск: журнал
 * оркестратора — источник истины о его действиях, молча проглоченная строка
 * прятала бы ровно тот сбой, ради видимости которого журнал и заведён.
 */
export const parseEventLine = (line: string): OrchestratorEvent => {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error(`строка журнала — не JSON: ${line}`);
  }
  return orchestratorEventSchema.parse(raw);
};

/** Текст журнала (JSONL) → события по порядку строк. Пустые строки пропускаются. */
export const parseJournal = (text: string): OrchestratorEvent[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(parseEventLine);

/** События → текст JSONL (с завершающим переводом строки — append дописывает следующую). */
export const renderJournal = (events: readonly OrchestratorEvent[]): string =>
  events.length === 0 ? "" : `${events.map(renderEventLine).join("\n")}\n`;
