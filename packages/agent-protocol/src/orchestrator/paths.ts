/**
 * Orchestrator paths are DERIVED, not passed in (john's decision, thread 012,
 * 22:45). Previously the journal, the three flags, the holds directory and the
 * mail root all arrived as arguments — that is, they lived in the correspondence
 * and in somebody's memory; the second time the thing was operated it started
 * with reconstructing the command from a chat.
 *
 * The split of responsibility here is exactly the one used across the package:
 * the project says WHERE (`orchestrator.state`, `orchestrator.mailCheckout` in
 * the config), the package says WHAT lies there. File names inside the state
 * directory are the package's own convention and are not exposed: they are its
 * own files.
 *
 * The function is pure: strings in, strings out. No file system — creating
 * directories belongs to the commands that own them.
 */
import { join } from "node:path";

import type { Mail, Orchestrator } from "../config/config.js";

export type OrchestratorPaths = {
  /** The whole operational-state directory — created by a command, not by a human. */
  readonly state: string;
  /** The event journal (JSONL, local, not in git). */
  readonly journal: string;
  /** The "launches are enabled" flag — created by `enable`. */
  readonly enableFlag: string;
  /** The graceful-stop flag. */
  readonly stopFlag: string;
  /** The force-stop flag (carries `by`/`note`). */
  readonly forceFlag: string;
  /** The directory of holds for manual sessions. */
  readonly holds: string;
  /** The directory of saved session outputs — silence can be examined without a witness. */
  readonly sessions: string;
  /**
   * The backgrounded daemon's own output, and the pid it was last started under
   * (`up`/`down`). A daemon sent to the background has no terminal to speak into, so
   * the two questions an operator asks about it — "what is it saying" and "is it
   * still there" — have to have answers on disk, or `up` becomes a command whose
   * result nobody can see.
   */
  readonly daemonLog: string;
  readonly daemonPid: string;
  /**
   * What the notifier has already reported (R4). It lives in the state directory for
   * the same reason the journal does: it is operational state, written by the package,
   * disposable. Losing it costs ONE repeated message about waits that are still open —
   * which is why the predecessor could keep it in `/tmp` and why nothing here is
   * designed to make it durable.
   */
  readonly notifyState: string;
  /**
   * The run of identical refusals from `gh` in the merge-ready tier (`outage.ts`, thread
   * 051): written by the daemon each tick, read by the courier and by the operator frame,
   * so the picture a human sees and the state the alarm rings from are ONE object.
   * Disposable for the same reason as the state above — losing it costs one repeated call.
   */
  readonly mergeReadyOutage: string;
  /** The mail root on disk: the mail-branch checkout plus the mail directory inside it. */
  readonly mailRoot: string;
};

/** Names inside the state directory are the package's convention, not project config. */
const JOURNAL = "journal.jsonl";
const ENABLE = "enabled";
const STOP = "stop";
const FORCE = "force";
const HOLDS = "holds";
const SESSIONS = "sessions";
const NOTIFY_STATE = "notify.state";
const MERGE_READY_OUTAGE = "merge-ready-outage.json";
const DAEMON_LOG = "daemon.log";
const DAEMON_PID = "daemon.pid";

export const orchestratorPaths = (input: {
  /** The repository root: paths in the config are relative to it. */
  readonly repo: string;
  readonly orchestrator: Orchestrator;
  readonly mail: Mail;
}): OrchestratorPaths => {
  const state = join(input.repo, input.orchestrator.state);
  return {
    state,
    journal: join(state, JOURNAL),
    enableFlag: join(state, ENABLE),
    stopFlag: join(state, STOP),
    forceFlag: join(state, FORCE),
    holds: join(state, HOLDS),
    sessions: join(state, SESSIONS),
    notifyState: join(state, NOTIFY_STATE),
    mergeReadyOutage: join(state, MERGE_READY_OUTAGE),
    daemonLog: join(state, DAEMON_LOG),
    daemonPid: join(state, DAEMON_PID),
    mailRoot: join(input.repo, input.orchestrator.mailCheckout, input.mail.dir),
  };
};

/**
 * One session's output file. The name carries the pair and the moment — the
 * journal then shows which run wrote where, and logs do not overwrite each other
 * across retries.
 */
export const sessionLogPath = (
  sessions: string,
  role: string,
  thread: string,
  stamp: string,
): string => join(sessions, `${stamp.replace(/[:]/g, "-")}-${role}-${thread}.log`);

/**
 * The RAW session stream beside the human log (R6). The rendering is lossy — it
 * previews texts and folds tool inputs — and its blind spots are exactly what one
 * needs when the rendering failed to explain a break. Same name, different
 * extension: the pair is obvious in a directory listing, and the journal keeps
 * pointing at the readable half.
 */
export const sessionStreamPath = (logPath: string): string => logPath.replace(/\.log$/, ".jsonl");

/**
 * WHERE THE SESSION READS ITS OWN ID (R7). The supervisor learns the id from the
 * init line of the stream and writes it here; the session gets the PATH in its
 * environment at spawn (`AGENT_PROTOCOL_SESSION_FILE`) — the id itself cannot travel
 * that way, because it does not exist yet at the moment the process is created.
 *
 * A third file of the same triple, named like the other two: whoever looks into the
 * sessions directory sees one run as one name with three extensions.
 */
export const sessionIdPath = (logPath: string): string => logPath.replace(/\.log$/, ".session");

/**
 * WHERE A RUN DECLARES A WAIT FOR INPUT (R19). Written by `new-message --await-input`
 * together with the question, removed by `await-input` when the wait ends, read by the
 * supervisor every poll — see `interactive.ts` for why the declaration is a runtime
 * file and not a field in the message header.
 *
 * THE PATH IS DERIVED FROM THE SESSION-ID FILE, i.e. from the one path the session
 * already has (`AGENT_PROTOCOL_SESSION_FILE` in its environment): the writer of the
 * marker is the session, the reader is its supervisor, and neither has to be told a
 * second path. Per-run by construction, so no run can ever meet somebody else's
 * declaration.
 */
export const sessionWaitPath = (logPath: string): string => logPath.replace(/\.log$/, ".waiting");

/**
 * The same file reached from the other end — from the session-id path, which is the
 * one path the SESSION itself is handed. `undefined` when the value is not of that
 * shape, and the caller refuses out loud: a blind `replace` on an unexpected name
 * would return the name unchanged, i.e. write the marker OVER the file it was derived
 * from.
 */
export const waitPathFromSessionFile = (sessionFile: string): string | undefined =>
  sessionFile.endsWith(".session") ? sessionFile.replace(/\.session$/, ".waiting") : undefined;

/**
 * WHERE A DETACHED SUPERVISOR SPEAKS (R12). An attached run says everything to the
 * terminal of whoever started it; a detached one has no terminal at all, and its own
 * words — the preflight, the refusals, the relayed session lines — would go to
 * /dev/null. They are not the same thing as the session log: this is what the
 * OBSERVER said, and the difference matters exactly when the observer is what broke.
 *
 * Same name, fourth extension: one run is one name in a directory listing.
 */
export const sessionSupervisorPath = (logPath: string): string =>
  logPath.replace(/\.log$/, ".supervisor");

/**
 * For a human — where the package put its state. Printed by the enable commands
 * and by `status`: "where the flag lies" has to be visible from the output, not
 * from the README.
 */
export const renderPaths = (paths: OrchestratorPaths): string =>
  [
    `state:    ${paths.state}`,
    `journal:  ${paths.journal}`,
    `flags:    ${paths.enableFlag} · ${paths.stopFlag} · ${paths.forceFlag}`,
    `holds:    ${paths.holds}`,
    `session logs: ${paths.sessions}`,
    `notify state: ${paths.notifyState}`,
    `mail:     ${paths.mailRoot}`,
  ].join("\n");
