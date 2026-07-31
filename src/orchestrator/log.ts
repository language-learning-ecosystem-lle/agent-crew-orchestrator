/**
 * A human-readable rendering of the orchestrator journal for john (step S4).
 * Unlike `status` (the current lease state — a fold), `log` shows the HISTORY:
 * what happened, when and with whom, event after event in order. A pure function.
 */
import type { OrchestratorEvent } from "./journal.js";

const detail = (event: OrchestratorEvent): string => {
  switch (event.kind) {
    case "lease-acquired":
      return ` (deadline ${event.deadline})`;
    case "lease-released": {
      // The exit code and the path to the output are the WHY, not just the WHAT:
      // without them a run that did not pass the turn is indistinguishable from a
      // run that simply finished.
      const code = event.exitCode === undefined ? "" : `, code ${event.exitCode}`;
      const log = event.output === undefined ? "" : `, output ${event.output}`;
      // The dirt left by a run that ended its own turn is named IN THE HISTORY too
      // (thread 023, requirement 5): the release said it once, on a terminal or in a
      // supervisor log nobody keeps open, and the question "which run left this tree" is
      // asked afterwards — of the journal.
      const dirty = event.dirty === true ? ", LEFT THE WORKSPACE DIRTY" : "";
      return ` (${event.reason}${code}${log}${dirty})`;
    }
    case "launch-refused":
      return ` (${event.reason})`;
    case "stop": {
      const by = event.by === undefined ? "" : `, by ${event.by}`;
      const note = event.note === undefined ? "" : `: ${event.note}`;
      return ` (${event.mode}${by}${note})`;
    }
    default:
      return ""; // launch, handoff-detected — no details
  }
};

const logLine = (event: OrchestratorEvent): string =>
  `${event.ts}  ${event.role}/${event.thread}  ${event.kind}${detail(event)}`;

export const renderLog = (events: readonly OrchestratorEvent[]): string =>
  events.length === 0 ? "orchestrator: the journal is empty" : events.map(logLine).join("\n");
