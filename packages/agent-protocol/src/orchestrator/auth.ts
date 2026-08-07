/**
 * THE AUTHORISATION REFUSAL — finding 1 of the "OAuth expiry of the laptop" episode
 * (thread 023, curator 2026-08-01T19:20Z), and a second instance of the shape finding C
 * gave the quota (`quota.ts`), not a new policy.
 *
 * WHAT WAS MEASURED. Between ~17:00 and ~19:15Z of 2026-08-01 the box's OAuth token was
 * dead. Every raised session printed `Failed to authenticate` on its first turn and died
 * in 0 seconds having spent $0 — and came back as `exited-without-handoff`, i.e. as a
 * FAILED ATTEMPT of the pair. Three of those exhaust a pair, so three pairs (019, 046,
 * 016) left the circuit without a fault of their own, and the daemon meanwhile span
 * "lease → death → lease" every tick, silently, until john noticed with his eyes.
 *
 * The diagnosis is the one the quota already has a name for: THE CAUSE IS THE BOX'S, NOT
 * THE PAIR'S. A dead token is infrastructure exactly like a closed window — it hits every
 * role of this instance at once, no session can do anything about it, and the counter
 * built to catch "this pair breaks on its own cause" measures nothing here but the
 * duration of the outage.
 *
 * WHAT THIS MODULE IS AND IS NOT — the same split the quota keeps: the RECOGNITION and
 * the arithmetic, pure, one line in and a verdict out. Which reason to record lives in
 * `observe.ts`, that the reason is not an attempt in `lease.ts` and `launch.ts`, and the
 * refusal to raise anybody while the shelf stands in `tick.ts`. Nothing here reads a file
 * or knows what a daemon is.
 *
 * WHERE THE SUBSTRING IS ALLOWED TO LOOK is not decided again here: it is `quota.ts`'s
 * `toolSurfacesOf`, the correction of 2026-07-30 paid for with three sessions cut off by
 * their own test data. The tool's voice is the launcher's non-JSON output, a `result`
 * event's `result` and an `assistant` message's text; everything else a stream event
 * carries is the SESSION's material and is never searched. This module reusing that
 * surface rather than copying a regex over whole lines is the whole reason the lesson
 * stays learnt when a third infrastructure signal arrives.
 *
 * WHY THERE IS NO STRUCTURED LAYER, said out loud. The quota has one (`rate_limit_event`)
 * because the vendor emits one. The authorisation refusal of the episode arrived as the
 * launcher's own prose BEFORE a session existed — there is no stream to carry a field. So
 * the net is prose only, and it is deliberately NARROW: the cost of a false positive here
 * is a ten-minute shelf on a healthy box, which is why the words below are the tool's own
 * refusals and not every sentence with "auth" in it.
 */

import { BOX_ACCOUNT, describeAccount, toolSurfacesOf } from "./quota.js";

/** The verdict for one line: the matched text, trimmed — what the log quotes as evidence. */
export type AuthSignal = {
  /** The matched text, trimmed — what the log and the journal quote as evidence. */
  readonly evidence: string;
};

/**
 * The refusals of the tool itself, in its own words. Kept to the shapes that mean "this
 * box cannot talk to the vendor at all":
 *
 *  - `Failed to authenticate` — the exact line of the episode, printed by the launcher;
 *  - `authentication_error` / `invalid_api_key` — the API's own error types;
 *  - `OAuth token has expired` / `Invalid API key` / `Please run /login` — the prose forms
 *    the tool prints when it stops before a session starts.
 *
 * A REFUSAL OF PERMISSION IS NOT ONE OF THEM: `permission_error`, a denied tool call and a
 * 403 about a repository all say the credentials WORK and something else was refused. The
 * shelf here stands the whole box down, so it may only be closed by "the door itself is
 * shut".
 */
const AUTH_REFUSAL =
  /(failed to authenticate|authentication_error|invalid_api_key|invalid api key|oauth token (has )?expired|expired oauth token|please run \/login|not (logged in|authenticated))/i;

/** How much of a matched line is quoted as evidence — enough to recognise, not a dump. */
const EVIDENCE = 200;

const evidenceOf = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EVIDENCE ? flat : `${flat.slice(0, EVIDENCE)}…`;
};

/**
 * ONE LINE OF THE SESSION STREAM (or of the launcher) → the authorisation verdict, or
 * `undefined` for every line that says nothing about credentials.
 *
 * Pure and total: it never throws.
 */
export const authSignalOf = (line: string): AuthSignal | undefined => {
  for (const surface of toolSurfacesOf(line)) {
    if (AUTH_REFUSAL.test(surface)) return { evidence: evidenceOf(surface) };
  }
  return undefined;
};

/**
 * The human line for the supervisor's log and its stream. It says the two things a reader
 * needs and refuses to say a third: that the run died on the BOX's credentials (not on its
 * own failure), and that the pair is not moving towards `exhausted`.
 *
 * The sentence about attempts is here for the same reason it is in the quota's line: the
 * whole value of this reason is that it does not count, and a property nobody can see is a
 * property nobody trusts.
 */
export const describeAuthRelease = (signal: AuthSignal): string =>
  `the box could not authenticate to the vendor: ${signal.evidence}. The run died on the CREDENTIALS OF THIS BOX, not on its own work — this does NOT count as a failed attempt, and the pair is not moving towards 'exhausted'.`;

/* ── THE SHELF ────────────────────────────────────────────────────────────────────────
 *
 * A dead token does not reopen by the clock the way a window does — it reopens when a
 * human runs `claude login` on this box. So the shelf here is NOT a wait for a stated
 * time (there is none to state), it is a RETRY INTERVAL: the difference between hammering
 * the closed door every tick and knocking on it every ten minutes.
 *
 * WHOSE SHELF IT IS. The instance's, and for the load-bearing reason the quota's is: the
 * credentials belong to the box, so a per-role shelf would stand one role down and walk
 * the other N−1 into the same refusal. One shelf, closed by a signal from any role.
 * Derived from the journal rather than stored beside the holds, for the same reason again:
 * the journal is append-only, local to this box and already read whole every tick, so the
 * shelf cannot drift from the events that produced it.
 *
 * WHAT THE "CHEAP PROBE BEFORE LIFTING" IS (curator's requirement (а), and the one place
 * this module answers it with a design rather than a mechanism). The probe is THE NEXT
 * LAUNCH ITSELF, and that is honest arithmetic rather than a shortcut: the episode
 * measured what an authorisation death costs — 0 seconds and $0, the process dies on its
 * first turn — and by requirement (б) it costs no attempt and no run budget either. A
 * dedicated prober would have to own the vendor binary, its credentials and a timeout of
 * its own in order to learn the same fact more expensively than the thing it replaces. So
 * the shelf expires, exactly one pair is raised, and one of two things happens: it works
 * (the box is alive, nothing was lost) or it dies in 0s and re-shelves the box for another
 * ten minutes. The alternative — a real probe command — is named in the PR as the open
 * question it is, not decided here in silence.
 */

/** The retry interval of a shelved box — see the block above for why it is not a wait. */
export const AUTH_SHELF_MINUTES = 10;

/**
 * THE CREDENTIALS ARE THE ACCOUNT'S, NOT THE BOX'S (thread 055, B.3) — the same correction
 * B.2 forced on the quota, and here it is sharper. A dead token was infrastructure of the
 * BOX while a box had one login; with several accounts on one machine (`accounts.<id>.
 * configDir`) each has its own `~/.claude` directory and its own OAuth token, and they
 * expire independently — that is the whole point of keeping them apart. A single shelf
 * would stand every role of the box down on a token that is dead for one of them, and,
 * worse in the other direction, would let ANY delivery break the run of deaths: a healthy
 * account delivering every ten minutes would keep resetting the counter of a dead one, so
 * the alarm that rings john (`authAlarmDue`) would never reach two.
 *
 * So the fold is per account, keyed exactly as the quota's is, with the same meaning for
 * silence: no `account` on the event is the box's own login ({@link BOX_ACCOUNT}), which
 * is where every event written before B.3 belongs and where it actually spent.
 */
export type AuthShelf = {
  /** Whose credentials were refused — the id, or {@link BOX_ACCOUNT} for the box's own. */
  readonly account: string;
  /** When the next launch is allowed — UTC ISO to the second. */
  readonly until: string;
  /** The stamp of the LAST refusal seen. */
  readonly since: string;
  /** The role whose session brought the signal in — evidence, not ownership. */
  readonly role: string;
  /**
   * How many authorisation deaths in a row led here. It is what makes the difference
   * between "a blip" and "the token is dead and the circuit is standing still" — the
   * predicate that rings john (requirement (в)) is built on it, not on the shelf existing.
   */
  readonly deaths: number;
};

/** The journal shape this fold reads — structural, so nothing here imports the daemon. */
type AuthEvent = {
  readonly kind: string;
  readonly ts: string;
  readonly role: string;
  readonly reason?: string | undefined;
  readonly account?: string | undefined;
};

/** The release reason this whole module is built around — one spelling, one place. */
export const AUTH_RELEASE_REASON = "auth-failed";

/**
 * THE JOURNAL → THE SHELF, if the box is still shelved at `now`.
 *
 * The LAST refusal sets the clock; `deaths` counts the run of them since the last
 * authorisation-clean delivery, which is what a repeated outage looks like from here. A
 * shelf whose `until` has passed is simply not returned: the retry interval ends by the
 * clock and by nothing else, because the thing that actually fixes it (a human logging in)
 * leaves no event in this journal to wait for.
 */
export const openAuthShelves = (events: readonly AuthEvent[], now: Date): readonly AuthShelf[] => {
  const runs = new Map<string, { ts: string; role: string; deaths: number }>();
  for (const event of events) {
    if (event.kind !== "lease-released") continue;
    const account = event.account ?? BOX_ACCOUNT;
    if (event.reason === AUTH_RELEASE_REASON) {
      runs.set(account, {
        ts: event.ts,
        role: event.role,
        deaths: (runs.get(account)?.deaths ?? 0) + 1,
      });
      continue;
    }
    // ANY OTHER COMPLETED RUN PROVES THE CREDENTIALS WORK — of THIS ACCOUNT and of no
    // other (B.3). The run of deaths is broken by it: the counter is about the CURRENT
    // outage, and an account that delivered since is not in one. A `launch-refused` does
    // not break it — nothing was raised, so nothing was proved either way.
    runs.delete(account);
  }
  const shelves: AuthShelf[] = [];
  for (const [account, last] of runs) {
    const until = `${new Date(new Date(last.ts).getTime() + AUTH_SHELF_MINUTES * 60_000)
      .toISOString()
      .slice(0, 19)}Z`;
    if (new Date(until).getTime() <= now.getTime()) continue;
    shelves.push({ account, until, since: last.ts, role: last.role, deaths: last.deaths });
  }
  return shelves.sort((a, b) => (a.until < b.until ? -1 : a.until > b.until ? 1 : 0));
};

/**
 * THE SHELF THAT STANDS IN THE WAY OF ONE CANDIDATE — the planner's whole question, and
 * the counterpart of `shelvesAgainst`: a candidate is refused by the dead credentials of
 * the account it would spend, and by nothing else.
 */
export const authShelfAgainst = (
  shelves: readonly AuthShelf[],
  account: string | undefined,
): AuthShelf | undefined => shelves.find((shelf) => shelf.account === (account ?? BOX_ACCOUNT));

/**
 * Whether the refusal of THIS shelf has already been written to the journal — the same
 * once-per-dark-spell rule the quota keeps (`quotaRefusalRecorded`), and for the same
 * reason: with a 60-second tick a shelved box would otherwise write ten identical
 * `launch-refused` lines per interval into the very file that has to be readable to
 * explain the stall.
 */
export const authRefusalRecorded = (events: readonly AuthEvent[], shelf: AuthShelf): boolean =>
  events.some(
    (event) =>
      event.kind === "launch-refused" && event.reason === "auth" && event.ts >= shelf.since,
  );

/**
 * HOW MANY DEATHS IN A ROW MEAN "THE TOKEN IS DEAD", rather than one bad launch. Two: the
 * first says something went wrong, the second says it is not going to fix itself. The
 * episode had a dozen before a human noticed.
 */
export const AUTH_ALARM_DEATHS = 2;

/**
 * THE PREDICATE THAT RINGS (requirement (в)) — the shelf ALONE does not: a box that failed
 * once and re-shelved is not an emergency, and an alarm that fires on every blip is one
 * nobody reads. The circuit standing still on credentials nobody can fix from inside it
 * is, and this is the line between the two.
 */
export const authAlarmDue = (shelf: AuthShelf): boolean => shelf.deaths >= AUTH_ALARM_DEATHS;

/** The shelf in a line — how long the box has been refused, and what happens next. */
export const describeAuthShelf = (shelf: AuthShelf): string =>
  `${describeAccount(shelf.account)} could not authenticate — ${shelf.deaths} run(s) in a row died on the vendor's credentials (last at ${shelf.since} on ${shelf.role}); nothing is raised until ${shelf.until}, when ONE pair is raised as the probe. If it dies too, the shelf is set again${
    authAlarmDue(shelf)
      ? ` — the token is dead and the circuit is standing still: \`claude login\` on this box for ${describeAccount(shelf.account)}`
      : ""
  }.`;
