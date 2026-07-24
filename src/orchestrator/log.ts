/**
 * Человекочитаемый вывод журнала оркестратора для john (шаг S4). В отличие от
 * `status` (текущее состояние аренд — свёртка), `log` показывает ИСТОРИЮ: что,
 * когда и с кем произошло, событие за событием по порядку. Чистая функция.
 */
import type { OrchestratorEvent } from "./journal.js";

const detail = (event: OrchestratorEvent): string => {
  switch (event.kind) {
    case "lease-acquired":
      return ` (deadline ${event.deadline})`;
    case "lease-released":
      return ` (${event.reason})`;
    case "launch-refused":
      return ` (${event.reason})`;
    case "stop": {
      const by = event.by === undefined ? "" : `, by ${event.by}`;
      const note = event.note === undefined ? "" : `: ${event.note}`;
      return ` (${event.mode}${by}${note})`;
    }
    default:
      return ""; // launch, handoff-detected — без деталей
  }
};

const logLine = (event: OrchestratorEvent): string =>
  `${event.ts}  ${event.role}/${event.thread}  ${event.kind}${detail(event)}`;

export const renderLog = (events: readonly OrchestratorEvent[]): string =>
  events.length === 0 ? "оркестратор: журнал пуст" : events.map(logLine).join("\n");
