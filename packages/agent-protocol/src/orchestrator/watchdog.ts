/**
 * THE WATCHDOG OF THE CIRCUIT — an outgoing dead-man's switch on the daemon PROCESS
 * (thread `017-circuit-watchdog`, curator's statement of work; john's decision of
 * 2026-08-19, `agent-comms/082-hetzner-migration/messages/2026-08-19T12-22-08Z-curator.md`,
 * step 5 of the move to hetzner).
 *
 * THE PRICE WAS PAID BEFORE THE CODE WAS WRITTEN: on 2026-08-18 the circuit stood dead
 * for 2 h 50 min behind a fully green dashboard. Everything that watches this project
 * was green and honest at the same time — the box's cron ping (`HEALTHCHECKS_URL`, §7 of
 * `docs/box-setup.md`) answers "is the box alive" and the box WAS alive; CI answers "does
 * the code build" and it did. Nobody at all was asking "is the DAEMON ticking", and a
 * question nobody asks has no wrong answer.
 *
 * THE BOX AND THE CIRCUIT ARE TWO ENTITIES AND EACH NEEDS ITS OWN WATCH. That is why the
 * URL here is a SECOND monitor and never the box's own: one endpoint pinged by two
 * senders goes on being green while either of them lives, so the day the daemon dies the
 * box's cron keeps the alarm quiet — which is precisely the 2 h 50 min, reproduced by
 * construction. Reusing the value is therefore refused BY NAME below, not merely
 * discouraged in a comment.
 *
 * WHY THIS IS NOT A REVERSAL OF `resident.ts`. That module refuses a heartbeat, and the
 * refusal stands, word for word: "an orphaned beating process holds the thing it beats
 * for forever, so 'it is alive' is the one claim a heartbeat cannot make truthfully".
 * What was refused there is a heartbeat as PROOF THAT A RESIDENT ROLE IS WORKING, written
 * INTO THE MAIL — a branch turned into a log of beats, and a claim ("the role is doing its
 * job") that beating cannot support. What is built here is the opposite direction on both
 * axes: the beat goes OUT of the box to a third party that never touches git, and the
 * claim it makes is the narrowest one there is — SILENCE IS AN ALARM.
 *
 * AND THE OTHER HALF, SAID OUT LOUD BECAUSE IT WILL BE FORGOTTEN OTHERWISE: "the tick
 * runs" IS WEAKER THAN "the circuit works". A daemon spinning in a loop, raising nobody,
 * refusing every candidate, unable to read the mail — beats. This watch catches ONE class:
 * THE PROCESS IS DEAD OR WAS NEVER STARTED. That class alone cost 2 h 50 min, which is why
 * it is worth a monitor; selling the green tick as "the circuit is healthy" is how a watch
 * becomes worse than none. The states this does NOT cover are covered elsewhere and by
 * other means — the skips on the daemon's stream, `orchestrator status`, `Notifier Watch`.
 *
 * THE DEGRADATION IS ONE-WAY, and it is the load-bearing property rather than a nicety: a
 * failed beat can never become the reason a role was not raised. No exception leaves this
 * module, the beat is bounded by its own timeout, and it is ISSUED at the top of a tick and
 * SETTLED at the bottom — so it runs alongside the tick's own work instead of in front of
 * it, and a monitor that hangs spends its timeout out of the idle sleep that follows, never
 * out of a launch. The same rule the merge-ready tier and the digest already live by.
 *
 * "AT THE BOTTOM" MEANS EVERY WAY OUT OF THE TICK AND NOT THE LAST LINE OF IT — the stop
 * flag, the unreadable mail, the halt, the ordinary end, AND `process.exit` on the handback
 * of a supervised daemon that repaired its own tree. The last one is the exit that has no
 * bottom to reach and it was missed on the first pass (the reviewer's finding on #36,
 * covered by a case since): the `--once` argument below is not about `--once`, it is about
 * every departure — a beat nobody waits for leaves the box only by luck, and measured, it
 * did not leave at all.
 *
 * WHERE THE VALUE LIVES: the secrets file of the machine config (R14, `secrets.envFile`) —
 * never `agent-protocol.json`. The URL is a credential in the exact sense that matters:
 * whoever knows it can silence the alarm. So this module takes it from the same loader the
 * transports use, and NEVER prints it — only the name of the key it came from.
 */

/** The key the circuit's own monitor is read from — the secrets file (R14). */
export const CIRCUIT_URL_KEY = "HEALTHCHECKS_CIRCUIT_URL";

/**
 * The key the BOX's cron watch already uses (§7 of `docs/box-setup.md`). Read here for
 * exactly one purpose: to refuse a circuit URL that is the same value.
 */
export const BOX_URL_KEY = "HEALTHCHECKS_URL";

/** How long one beat may take before it is abandoned. Short on purpose — see the header. */
export const BEAT_TIMEOUT_MS = 5_000;

export type WatchdogState =
  /** No beat will be sent, and the reason is a sentence an operator can act on. */
  { readonly kind: "off"; readonly reason: string } | { readonly kind: "on"; readonly url: string };

/**
 * Decide whether this box beats, from the secrets it was given. Pure, and the whole of
 * the policy: absence is legitimate (a box that watches nothing is a normal box), while
 * a value that is PRESENT and unusable is a defect and is named as one.
 *
 * The three refusals are all "the operator meant to switch this on and it will not work",
 * which is the class discipline 4 of the role card is about: a door that says nothing is
 * worse than no door. An empty value, a value that is not an http(s) URL, and the box's
 * own URL each get their own sentence naming what to change.
 */
export const resolveWatchdog = (input: {
  readonly secrets: Readonly<Record<string, string | undefined>>;
  /** Which file the values came from, for the reason lines. `null` — the environment. */
  readonly source?: string | null;
}): WatchdogState => {
  const where =
    input.source === undefined || input.source === null
      ? "the environment (no secrets file is named in the machine config)"
      : `'${input.source}'`;
  const raw = (input.secrets[CIRCUIT_URL_KEY] ?? "").trim();
  if (raw === "") {
    return {
      kind: "off",
      reason: `no '${CIRCUIT_URL_KEY}' in ${where} — this daemon sends NO dead-man ping, and a dead circuit will look exactly like a quiet night. Put the URL of a monitor of its own there (NOT the box's '${BOX_URL_KEY}'); everything else works as before`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      kind: "off",
      reason: `'${CIRCUIT_URL_KEY}' in ${where} is not a URL — no ping is sent (the value is not shown: it is a credential, whoever knows it can silence the alarm)`,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      kind: "off",
      reason: `'${CIRCUIT_URL_KEY}' in ${where} is '${parsed.protocol}//…', and a ping is an HTTP request — no ping is sent`,
    };
  }
  const box = (input.secrets[BOX_URL_KEY] ?? "").trim();
  if (box !== "" && box === raw) {
    return {
      kind: "off",
      reason: `'${CIRCUIT_URL_KEY}' in ${where} is the SAME value as '${BOX_URL_KEY}' — refused: the box's cron and this daemon would beat one monitor, so it stays green while EITHER of them lives and the death of the daemon behind a living box (2 h 50 min on 2026-08-18) is the one case that watch would miss. Make a second monitor and put ITS url here`,
    };
  }
  return { kind: "on", url: raw };
};

/** The startup line. Says which key spoke, never what it said. */
export const describeWatchdog = (state: WatchdogState): string =>
  state.kind === "off"
    ? `circuit watchdog OFF — ${state.reason}`
    : `circuit watchdog ON — every tick pings the monitor named by '${CIRCUIT_URL_KEY}' (value not shown). It proves ONE thing: this process is ticking. It does NOT prove that anybody is being raised — silence is the alarm, a beat is not a health report`;

export type BeatOutcome =
  | { readonly kind: "beat"; readonly status: number }
  | { readonly kind: "refused"; readonly detail: string };

/** The shape of `fetch` this module needs — injected so no test ever reaches a network. */
export type FetchLike = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number }>;

/**
 * One beat. NEVER REJECTS and never throws: every failure — a dead network, a 5xx, a
 * timeout — comes back as `refused` with a sentence. That is what lets the caller start
 * it without a `catch` and not risk an unhandled rejection taking the daemon down, which
 * would turn the watch into the thing that kills what it watches.
 */
export const beat = async (input: {
  readonly url: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
}): Promise<BeatOutcome> => {
  const timeoutMs = input.timeoutMs ?? BEAT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await input.fetch(input.url, { signal: controller.signal });
    if (!response.ok) return { kind: "refused", detail: `the monitor answered ${response.status}` };
    return { kind: "beat", status: response.status };
  } catch (error) {
    // The URL is a credential and never reaches a log — including through an error
    // message, which is where `fetch` likes to put the thing it could not reach.
    const message = (error as Error).message;
    return {
      kind: "refused",
      detail: controller.signal.aborted
        ? `no answer in ${timeoutMs / 1000}s`
        : `the request failed (${message.includes(input.url) ? "the reason names the url and is not shown" : message})`,
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The line for the stream, or nothing. SAID ON A CHANGE, never every tick: a beacon that
 * announced its success every thirty seconds is the noise that teaches its reader to skip
 * the section the one time it says something else. A failure is said when it starts and
 * when its wording changes, and the recovery is said too — a watch whose outage nobody saw
 * end is a watch nobody trusts.
 */
export const describeBeat = (outcome: BeatOutcome, previous?: BeatOutcome): string | undefined => {
  if (outcome.kind === "beat") {
    if (previous === undefined || previous.kind === "beat") return undefined;
    return "circuit watchdog — the monitor answers again; the dead-man ping is being delivered";
  }
  if (previous?.kind === "refused" && previous.detail === outcome.detail) return undefined;
  return `circuit watchdog — the dead-man ping was NOT delivered: ${outcome.detail}. The daemon keeps working and raising roles; what is at risk is the ALARM — if this box dies now, the monitor's silence is the only thing left to notice it`;
};

/**
 * The beacon a tick drives: `start()` at the top, `settle()` at the bottom.
 *
 * THE SPLIT IS THE WHOLE POINT. Issuing and awaiting in one place would put the beat's
 * latency in front of the tick's work (statement of work, point 3: the tick does not slow
 * down); firing and never awaiting would let `--once` — the shape of every cron entry and
 * every check — exit before the request left the box, i.e. a watchdog that silently never
 * beats in the one mode that is easiest to deploy. So the request runs ALONGSIDE the tick
 * and is settled where the tick was going to sleep anyway.
 *
 * A beat still in flight when the next `start()` comes is NOT doubled: the tick that owns
 * it settles it, and a second request on top would say nothing the first one does not.
 */
export type Beacon = {
  /** Issue this tick's beat. No-op when the watchdog is off, or one is already in flight. */
  readonly start: () => void;
  /** Wait out the beat of this tick and say what came of it, if it changed. */
  readonly settle: () => Promise<void>;
};

export const watchdogBeacon = (input: {
  readonly state: WatchdogState;
  readonly fetch: FetchLike;
  readonly note: (line: string) => void;
  readonly timeoutMs?: number;
}): Beacon => {
  let inFlight: Promise<BeatOutcome> | undefined;
  let previous: BeatOutcome | undefined;
  return {
    start: () => {
      if (input.state.kind === "off" || inFlight !== undefined) return;
      inFlight = beat({
        url: input.state.url,
        fetch: input.fetch,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      });
    },
    settle: async () => {
      if (inFlight === undefined) return;
      const outcome = await inFlight;
      inFlight = undefined;
      const line = describeBeat(outcome, previous);
      previous = outcome;
      if (line !== undefined) input.note(line);
    },
  };
};
