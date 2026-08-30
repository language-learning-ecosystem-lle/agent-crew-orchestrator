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
 * module, the beat is bounded by its own budget, and it is ISSUED at the top of a tick and
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
 *
 * ONE BOX, TWO CIRCUITS, TWO MONITORS — AND WHY THE KEY CARRIES THE INSTANCE'S NAME rather
 * than the instances carrying a secrets file each (curator's statement of work of
 * 2026-08-21, this thread). A box that hosts several instances answers each of them from
 * its own machine config (`instances/<name>.json`), and on the box this code runs on BOTH
 * of those configs name the SAME `secrets.envFile`. One key in that file therefore means
 * one monitor beaten by two daemons — which is the header's own refusal (a monitor with two
 * senders stays green while EITHER lives) reappearing one level up, between circuits
 * instead of between the box and the daemon.
 *
 * The nil-code alternative — a secrets file per instance — was weighed and refused, and the
 * argument is not taste: it moves the collision ACROSS FILES, where no process can see it.
 * Each daemon loads its own file, never the other's, so "both configs point at one URL"
 * becomes a state nothing is able to refuse, and the defect we are repairing is not
 * inconvenience, it is SILENCE BY CONSTRUCTION. Keeping both keys in one file keeps the two
 * monitors where they are read side by side and makes a duplicate value REFUSABLE BY NAME
 * inside the process — which is what the last rule below does.
 *
 * The rule, whole (`resolveWatchdog`): a NAMED instance beats the monitor of
 * `HEALTHCHECKS_CIRCUIT_URL_<INSTANCE>` and nothing else; a named instance with only the
 * bare key present is OFF WITH A REASON, because that is not a missing fallback, it is
 * exactly the configuration being repaired; an UNNAMED box (`local.json`, one circuit)
 * reads the bare key and behaves byte for byte as before. Both keys present is the
 * MIGRATION and is legitimate: the suffixed one wins and the bare one is named as ignored
 * in one line, so the keys can be laid down BEFORE the restart and the live daemon — whose
 * code was loaded once, at start — goes on reading the bare key until it is restarted.
 * That is a migration with no window of silence, which is the only kind worth offering for
 * a watch.
 */

/**
 * The key the circuit's own monitor is read from — the secrets file (R14). The bare form:
 * what an unnamed box reads, and what a named instance reads NOTHING from (see the header).
 */
export const CIRCUIT_URL_KEY = "HEALTHCHECKS_CIRCUIT_URL";

/**
 * The key the BOX's cron watch already uses (§7 of `docs/box-setup.md`). Read here for
 * exactly one purpose: to refuse a circuit URL that is the same value.
 */
export const BOX_URL_KEY = "HEALTHCHECKS_URL";

/**
 * How long ONE ATTEMPT may take before it is abandoned, how many attempts a beat makes, the
 * pause between them, and the ceiling on the whole beat.
 *
 * WHY THESE NUMBERS AND NOT THE 5 s THAT STOOD HERE (thread `057-circuit-ping-flaps`,
 * measured 2026-08-30). The single 5 s attempt with no retry made the watch FLAP: 182 lines
 * in one daemon log, `NOT delivered` and `answers again` strictly alternating, one pair per
 * tick or two — and every one of them a false alarm that sent john to a healthy box.
 *
 * The measurement refuses the obvious reading. 40 requests from the box to the monitor host:
 * median 0.49 s, worst 1.18 s, DNS 0.5 ms warm — an order of magnitude under the old 5 s. The
 * network was never near the threshold, so "the monitor is slow" is not the cause.
 * What the journal shows instead: the beat is issued at the TOP of a tick, the tick then does
 * its work through SYNCHRONOUS git (`fs/exec-sync.ts` — the courier, the candidate scan), and
 * a blocked event loop delivers no socket callback and runs no timer. The 5 s abort therefore
 * fired on a request whose 0.5 s of network had nowhere to be noticed: the process starved its
 * own watch, and the tick after it — with less to do — "recovered". `15:03:04` issued,
 * `15:03:09` NOT delivered, `15:03:44` answers again, on a box whose `curl` answers in half a
 * second, is that and nothing else.
 *
 * SO THE REPAIR IS RETRIES FIRST AND THE TIMEOUT SECOND. A second attempt is made after the
 * first one is settled — i.e. at the bottom of the tick, where the loop is free again — so it
 * costs 0.5 s and lands. A longer single timeout alone would only move the flap to whichever
 * tick blocks for longer than the new number. The form is the box cron's, which never flapped
 * (`docs/box-setup.md` §7: `curl -fsS -m 10 --retry 3`): ten seconds an attempt, three
 * attempts, a pause between them.
 *
 * AND THE BUDGET IS WHAT KEEPS THE DEGRADATION ONE-WAY. A beat is settled where the tick was
 * going to sleep, so its cost is the delay before the NEXT tick may raise a role — three full
 * timeouts would be 30 s of that. The budget bounds the whole beat, the last attempt's own
 * timeout is clipped to what is left of it, and `beatBudgetFor` clips the budget to the tick
 * itself: a box that ticks faster than one attempt makes one attempt and no retries.
 */
export const BEAT_TIMEOUT_MS = 10_000;

/** How many attempts one beat may make — the cron's `--retry 3` (`docs/box-setup.md` §7). */
export const BEAT_ATTEMPTS = 3;

/**
 * The pause between attempts. Not zero: an immediate retry re-runs into whatever was in the
 * way — the same blocked millisecond, the same reset connection — and proves nothing new.
 */
export const BEAT_RETRY_PAUSE_MS = 1_000;

/** The ceiling on a whole beat, retries and pauses included. See the block above. */
export const BEAT_BUDGET_MS = 20_000;

/**
 * The budget a daemon of this tick may spend on one beat. The tick is the ceiling because the
 * beat is settled in front of the sleep: spending longer than a tick on the watch would make
 * the watch the reason a role waited, which is the one thing this module may never become.
 * The floor is one attempt — below that a retry cannot happen at all, and that is said here
 * rather than discovered as a mysteriously non-retrying box.
 */
export const beatBudgetFor = (tickMs: number): number =>
  Math.min(BEAT_BUDGET_MS, Math.max(BEAT_TIMEOUT_MS, tickMs));

export type WatchdogState =
  /** No beat will be sent, and the reason is a sentence an operator can act on. */
  | { readonly kind: "off"; readonly reason: string }
  | {
      readonly kind: "on";
      readonly url: string;
      /** WHICH KEY SPOKE — the banner says the name, never the value. */
      readonly key: string;
      /** One more line when something present was deliberately not read (the migration). */
      readonly note?: string;
    };

/**
 * The key of a NAMED instance: the bare key plus the name in UPPER_SNAKE
 * (`acme-box` → `HEALTHCHECKS_CIRCUIT_URL_ACME_BOX`).
 *
 * A name that does not become a legal environment key is REFUSED rather than mangled into
 * one. Mangling would be the same class of silence as everything else in this module: two
 * instances whose names differ only in a character the mangler drops would land on ONE key
 * and beat ONE monitor, and the operator would have no way to see it — the file would look
 * as if it named two.
 */
export const circuitKeyOf = (
  instance: string,
):
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "bad"; readonly reason: string } => {
  const suffix = instance.trim().replace(/-/g, "_").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(suffix)) {
    return {
      kind: "bad",
      reason: `the instance is named '${instance}', and '${CIRCUIT_URL_KEY}_${suffix}' is not a legal key of a secrets file — no ping is sent. An instance whose monitor is to be read here is named with letters, digits, '-' and '_', starting with a letter (the name becomes the key's suffix in UPPER_SNAKE); rename the instance or leave this box unnamed`,
    };
  }
  return { kind: "key", key: `${CIRCUIT_URL_KEY}_${suffix}` };
};

/**
 * Decide whether this box beats, from the secrets it was given. Pure, and the whole of
 * the policy: absence is legitimate (a box that watches nothing is a normal box), while
 * a value that is PRESENT and unusable is a defect and is named as one.
 *
 * The refusals are all "the operator meant to switch this on and it will not work", which
 * is the class discipline 4 of the role card is about: a door that says nothing is worse
 * than no door. An empty value, a value that is not an http(s) URL, an unusable instance
 * name, a named instance carrying only the bare key, and a value that is ALREADY IN THE
 * FILE UNDER ANOTHER NAME each get their own sentence naming what to change.
 *
 * THE LAST ONE IS THE GENERAL FORM OF THE BOX-URL REFUSAL, and it is what actually catches
 * the hand that pastes one URL under two instances: any other key of the SAME FILE holding
 * this same value means two senders on one monitor, whoever they are. The box's own key
 * keeps its own sentence because its case has a history an operator should be told about,
 * not because its logic is different.
 *
 * TWO NAMES ARE LEFT OUT OF THAT COMPARISON ON PURPOSE — the key being read and the bare
 * key. A named instance during the migration has the bare key sitting there holding the
 * very same URL, put there for the daemon that is still running the old code; refusing it
 * would forbid the one migration order that has no window of silence.
 */
export const resolveWatchdog = (input: {
  readonly secrets: Readonly<Record<string, string | undefined>>;
  /** Which file the values came from, for the reason lines. `null` — the environment. */
  readonly source?: string | null;
  /**
   * The instance whose machine config answered for THIS daemon, or `null`/absent for the
   * unnamed config of a one-circuit box. Taken from the config resolver and never from a
   * flag of its own: which instance this is, is a fact of the box.
   */
  readonly instance?: string | null;
  /**
   * The names that came out of the secrets FILE — the scope of the duplicate-value
   * refusal. Absent means "the whole of what was given", which is what an environment-only
   * box has.
   */
  readonly names?: readonly string[];
}): WatchdogState => {
  const where =
    input.source === undefined || input.source === null
      ? "the environment (no secrets file is named in the machine config)"
      : `'${input.source}'`;
  const instance = input.instance ?? null;

  let key = CIRCUIT_URL_KEY;
  let note: string | undefined;
  const bare = (input.secrets[CIRCUIT_URL_KEY] ?? "").trim();
  if (instance !== null && instance !== "") {
    const named = circuitKeyOf(instance);
    if (named.kind === "bad") return { kind: "off", reason: named.reason };
    key = named.key;
    const own = (input.secrets[key] ?? "").trim();
    if (own === "" && bare !== "") {
      return {
        kind: "off",
        reason: `this daemon is instance '${instance}' and ${where} carries the bare '${CIRCUIT_URL_KEY}' but no '${key}' — refused, and NOT fallen back on: a box that hosts several instances answers them from one secrets file, so the bare key means every daemon here beats ONE monitor and the death of any one of them stops being visible. Put this instance's own monitor under '${key}'`,
      };
    }
    if (own !== "" && bare !== "") {
      note = `'${CIRCUIT_URL_KEY}' is set in ${where} as well and is IGNORED here — a named instance reads '${key}' only. Remove the bare key once every instance on this box has its own`;
    }
  }

  const raw = (input.secrets[key] ?? "").trim();
  if (raw === "") {
    return {
      kind: "off",
      reason: `no '${key}' in ${where} — this daemon sends NO dead-man ping, and a dead circuit will look exactly like a quiet night. Put the URL of a monitor of its own there (NOT the box's '${BOX_URL_KEY}', and not another instance's); everything else works as before`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      kind: "off",
      reason: `'${key}' in ${where} is not a URL — no ping is sent (the value is not shown: it is a credential, whoever knows it can silence the alarm)`,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      kind: "off",
      reason: `'${key}' in ${where} is '${parsed.protocol}//…', and a ping is an HTTP request — no ping is sent`,
    };
  }
  const box = (input.secrets[BOX_URL_KEY] ?? "").trim();
  if (box !== "" && box === raw) {
    return {
      kind: "off",
      reason: `'${key}' in ${where} is the SAME value as '${BOX_URL_KEY}' — refused: the box's cron and this daemon would beat one monitor, so it stays green while EITHER of them lives and the death of the daemon behind a living box (2 h 50 min on 2026-08-18) is the one case that watch would miss. Make a second monitor and put ITS url here`,
    };
  }
  const scope = input.names ?? Object.keys(input.secrets);
  const twins = scope.filter(
    (name) =>
      name !== key && name !== CIRCUIT_URL_KEY && (input.secrets[name] ?? "").trim() === raw,
  );
  if (twins.length > 0) {
    return {
      kind: "off",
      reason: `'${key}' in ${where} is the SAME value as ${twins.map((name) => `'${name}'`).join(", ")} — refused: one monitor beaten by two senders stays green while either of them lives, so the death of one is invisible, which is the whole of what this watch exists to catch. Give this instance a monitor of its own (the values are not shown — only the names)`,
    };
  }
  return { kind: "on", url: raw, key, ...(note === undefined ? {} : { note }) };
};

/** The startup line. Says which key spoke, never what it said. */
export const describeWatchdog = (state: WatchdogState): string =>
  state.kind === "off"
    ? `circuit watchdog OFF — ${state.reason}`
    : `circuit watchdog ON — every tick pings the monitor named by '${state.key}' (value not shown). It proves ONE thing: this process is ticking. It does NOT prove that anybody is being raised — silence is the alarm, a beat is not a health report${
        state.note === undefined ? "" : `. ${state.note}`
      }`;

export type BeatOutcome =
  | {
      readonly kind: "beat";
      readonly status: number;
      /** How many attempts it took. 1 is the ordinary day; more is a beat that was retried. */
      readonly attempts: number;
    }
  | {
      readonly kind: "refused";
      /**
       * WHY it was refused, and the ONLY field `describeBeat` compares. Stable on purpose:
       * the counts and the clock below move from beat to beat, and a line that changed with
       * them would be the every-tick noise this module exists not to print.
       */
      readonly detail: string;
      /** How many attempts were spent before giving up. */
      readonly attempts: number;
      /** Wall clock of the whole beat — the evidence for the field below. */
      readonly elapsedMs: number;
      /**
       * THE BEAT WAITED LONGER THAN ITS OWN TIMEOUTS ALLOW, so the time went somewhere no
       * timeout can account for: this process was not running its loop. That is the
       * `057-circuit-ping-flaps` class, and the line says it — a watch that reports "the
       * monitor is silent" when the truth is "I was too busy to listen" sends a human to the
       * wrong box.
       */
      readonly starved: boolean;
    };

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
 *
 * THE CLOCK IS INJECTED, AND THAT IS NOT A CONVENIENCE — it is this thread's own lesson
 * applied to the test (curator's finding on #148). Every decision below is arithmetic on
 * the wall clock: whether a retry still fits the budget, how much of an attempt is left,
 * whether the beat outran everything its timeouts allowed. A test that drove those
 * decisions with REAL `setTimeout` would be asserting on timer drift — node's timers fire
 * no earlier than their nominal, never exactly at it — and the first version of the budget
 * case did exactly that, with zero margin: it passed locally and failed on the runner. A
 * red that lies about the code is the same class, one floor up, as a watchdog that blames
 * the monitor for its own starvation. So the CLOCK is what a test replaces, and the
 * arithmetic under test is then exact; production passes nothing and reads `Date.now`.
 */
export const beat = async (input: {
  readonly url: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly attempts?: number;
  readonly retryPauseMs?: number;
  readonly budgetMs?: number;
  /** The wall clock this beat measures itself by. Injected for tests only — see above. */
  readonly now?: () => number;
}): Promise<BeatOutcome> => {
  const timeoutMs = input.timeoutMs ?? BEAT_TIMEOUT_MS;
  const limit = Math.max(1, input.attempts ?? BEAT_ATTEMPTS);
  const pauseMs = input.retryPauseMs ?? BEAT_RETRY_PAUSE_MS;
  const budgetMs = input.budgetMs ?? Math.max(timeoutMs, BEAT_BUDGET_MS);
  const now = input.now ?? Date.now;
  const started = now();
  let last = "";
  /** What the timeouts and pauses ALLOWED — the yardstick the wall clock is judged against. */
  let allowed = 0;
  let made = 0;

  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const left = budgetMs - (now() - started);
    // A retry with less than half an attempt's room left is not made at all: a timeout
    // clipped to a sliver would report "no answer in 0.2s" about a monitor that was never
    // really asked, and a false detail is worse than a missing retry.
    if (attempt > 1 && left < timeoutMs / 2) break;
    const attemptMs = attempt === 1 ? timeoutMs : Math.min(timeoutMs, left);
    allowed += attemptMs;
    made = attempt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptMs);
    let refusal: string;
    try {
      const response = await input.fetch(input.url, { signal: controller.signal });
      if (response.ok) return { kind: "beat", status: response.status, attempts: attempt };
      refusal = `the monitor answered ${response.status}`;
    } catch (error) {
      // The URL is a credential and never reaches a log — including through an error
      // message, which is where `fetch` likes to put the thing it could not reach.
      const message = (error as Error).message;
      refusal = controller.signal.aborted
        ? `no answer in ${attemptMs / 1000}s`
        : `the request failed (${message.includes(input.url) ? "the reason names the url and is not shown" : message})`;
    } finally {
      clearTimeout(timer);
    }
    last = refusal;

    if (attempt === limit) break;
    if (pauseMs > 0) {
      const room = budgetMs - (now() - started);
      if (room <= pauseMs) break;
      allowed += pauseMs;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    // The detail of the LAST attempt is what the caller is told, so a retry that changed the
    // failure (a timeout that became a 503) reports what is true now, not what was true first.
  }

  const elapsedMs = now() - started;
  return {
    kind: "refused",
    detail: last,
    attempts: made,
    elapsedMs,
    // A 50 % overrun of everything the timeouts and pauses allowed is not jitter; nothing but
    // a loop that was not running can produce it.
    starved: elapsedMs > allowed * 1.5,
  };
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
  // The counts and the clock are PRINTED but never compared: they move every time, and a
  // comparison over them would put a line on the stream each tick of one outage.
  const tries =
    outcome.attempts === 1
      ? "1 attempt"
      : `${outcome.attempts} attempts, ${outcome.elapsedMs / 1000}s`;
  const blame = outcome.starved
    ? ". And THAT WAIT WAS THIS PROCESS, not the monitor: the beat took longer of the wall clock than its own timeouts allow, which only a loop that was not running can do — look at what the tick does synchronously before you look at the network"
    : "";
  return `circuit watchdog — the dead-man ping was NOT delivered after ${tries}: ${outcome.detail}. The daemon keeps working and raising roles; what is at risk is the ALARM — if this box dies now, the monitor's silence is the only thing left to notice it${blame}`;
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
  readonly attempts?: number;
  readonly retryPauseMs?: number;
  readonly budgetMs?: number;
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
        ...(input.attempts === undefined ? {} : { attempts: input.attempts }),
        ...(input.retryPauseMs === undefined ? {} : { retryPauseMs: input.retryPauseMs }),
        ...(input.budgetMs === undefined ? {} : { budgetMs: input.budgetMs }),
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
