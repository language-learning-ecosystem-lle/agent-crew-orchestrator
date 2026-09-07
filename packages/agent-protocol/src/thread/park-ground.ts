/**
 * A PARK WITH NO CHECKABLE GROUND (thread `155-park-has-no-checkable-ground`).
 *
 * A park says WHAT it stands behind — a person, a merge, a round — and never WHAT FACT it is
 * waiting on. That fact lives in the prose of the body, which means exactly one thing: whether
 * the ground is still alive can be answered by a memory and by nothing else. Three cases in two
 * days, each with a measured price (curator's statement of work, 2026-09-07):
 *
 *  1. a park set under decisions of john at 03.09 17:41Z, answered the same evening, standing
 *     21 h 23 m over a ready PR nobody could take;
 *  2. a park lifted by a `delivers` letter that did not close the turn — twice in one hour, two
 *     raises of a pair that read "nothing unread" and spent its slot putting the park back;
 *  3. a park asking john to unfreeze a pair THAT HIS OWN HAND HAD UNFROZEN that morning: the
 *     role's reading was of an older world, and the park then locked BOTH pairs of the thread
 *     over five commits already lying on `origin`.
 *
 * DISCIPLINE DOES NOT REPAIR IT, and the proof is inside the cases: the rule "a park is set by a
 * question and lifted by its answer" is written in the chat curator's own skill, and it was
 * broken twice in an hour; the norm `050-park-only-on-a-question` has been in `main` since 29.08
 * and case (3) happened under it.
 *
 * WHAT THIS ADDS is an ADDRESS for the ground: an optional field on the parking message naming
 * the fact the park waits on, in a form the circuit can ASK rather than remember. The park is
 * unchanged in every other respect, and four properties are load-bearing (statement of work,
 * §3):
 *
 *  · A PARK ON A PERSON'S WORD STAYS LEGAL AND UNNAMED. "I wait for a decision of john" is the
 *    commonest park there is and no fact expresses it; the field is for the REST.
 *  · NOT A NEW OBLIGATION: no ground named — behaviour is exactly today's, everywhere.
 *  · IT SPEAKS, IT DOES NOT LIFT. A park whose ground has fallen away is NAMED, once; the hand
 *    that lifts it is still a hand. The circuit spent this week choosing the note over the
 *    refusal in every comparable place, and a park is the state a machine has the least right to
 *    end by itself: the thread may have grown a second reason while nobody was reading.
 *  · ONCE PER TRANSITION, not once per tick — {@link foldGroundNotes}. A sentence repeated 71
 *    times is a sentence nobody reads.
 *
 * TWO FORMS, and each one is the measurement of a case above:
 *
 *  · `frozen:<role>×<thread>` — case (3). The ground that was named in a letter to john, that was
 *    already false when the letter was written, and that this box can answer WITHOUT ASKING
 *    ANYBODY, out of the same journal the tick already reads to plan on.
 *  · `no-delivers-since:<thread>` — case (1), the park that outlived its answer by 21 h 23 m over
 *    a ready PR. The word of a person reaches this circuit in exactly one readable way — a letter
 *    carrying `delivers: <person>` — so "he has not answered yet" has an address in the SAME MAIL
 *    the tick already scans, and no new source is added for it either.
 *
 * THE WINDOW OF THE SECOND FORM IS MEASURED FROM THE PARK, not from the beginning of the thread
 * (statement of work, §3.5): a `delivers` that was already lying in the feed when the park was
 * declared is not an answer to it, and reading it as one would make EVERY named ground read as
 * fallen away — the feature would then be loudest exactly where it promised to be silent. That is
 * the shape of the defect the seam test caught on `pairKey` in the first round, and the window is
 * what keeps it from coming back in the second.
 *
 * WHAT THE SECOND FORM DOES NOT COVER, said out loud rather than stretched to fit (statement of
 * work, §2): case (2) — "`delivers` arrived and the turn stayed" — is about the LIFT of a park (a
 * delivering letter lifts it by itself), not about its ground, and no ground can address it. It
 * stays without an address until the lift is opened as a subject of its own.
 *
 * The parser refuses everything else BY NAME, so a third form is a change here and a change to
 * that refusal, and never a value that means nothing lying silently in the feed.
 */

import type { Parking } from "./thread.js";

/** The separator of a pair as the circuit writes it everywhere; `*` is the ASCII spelling. */
const PAIR_SEPARATORS = ["×", "*"] as const;

/** WHAT a `park-ground` value names. Two kinds today — see the head of this file. */
export type ParkGround =
  | {
      readonly kind: "frozen";
      /** The role of the pair whose freeze is the ground. */
      readonly role: string;
      /** The thread of that pair. */
      readonly thread: string;
      /** The value as the writer typed it, canonicalised to `×`, for every sentence quoting it. */
      readonly raw: string;
    }
  | {
      readonly kind: "no-delivers-since";
      /** The thread whose feed is asked for a `delivers` letter. */
      readonly thread: string;
      /** The value as the writer typed it, for every sentence that quotes it. */
      readonly raw: string;
    };

/** The id of a thread, as every other door of this package spells it. */
const THREAD_ID = "[A-Za-z0-9][A-Za-z0-9._-]*";

/** The shape a header value must have to be read at all — the tolerant reader's only demand. */
export const PARK_GROUND = new RegExp(
  `^(?:frozen:[a-z0-9][a-z0-9-]*[×*]${THREAD_ID}|no-delivers-since:${THREAD_ID})$`,
);

/**
 * THE ONE PARSER OF THE FIELD, for the door and for every reader that judges a ground.
 *
 * `undefined` is "this is not a ground this version knows" — the caller decides whether that is
 * a refusal (the door, where it can still be repaired) or a silence (a reader of an append-only
 * feed, which cannot repair anything and must not invent a meaning for it).
 */
export const parseParkGround = (raw: string): ParkGround | undefined => {
  if (!PARK_GROUND.test(raw)) return undefined;
  if (raw.startsWith("no-delivers-since:")) {
    const thread = raw.slice("no-delivers-since:".length);
    if (thread === "") return undefined;
    return { kind: "no-delivers-since", thread, raw: `no-delivers-since:${thread}` };
  }
  const body = raw.slice("frozen:".length);
  const at = PAIR_SEPARATORS.map((separator) => body.indexOf(separator)).find((index) => index > 0);
  if (at === undefined) return undefined;
  const role = body.slice(0, at);
  const thread = body.slice(at + 1);
  if (role === "" || thread === "") return undefined;
  return { kind: "frozen", role, thread, raw: `frozen:${role}×${thread}` };
};

/** The verdict of the door on the value itself: it names a checkable fact, or it plainly does not. */
export type ParkGroundVerdict =
  | { readonly ok: true; readonly ground: ParkGround }
  | { readonly ok: false; readonly reason: string };

/**
 * IS THIS A FACT THE CIRCUIT CAN ASK — the check at the door of the field.
 *
 * A refusal and not a note, and the asymmetry is deliberate: the value is the whole point of the
 * field, an unreadable one is a promise of a check that will never run, and unlike the park
 * itself it costs nothing to repair — the writer is standing right there. What is NEVER refused
 * is the absence of the field (see the head of this file, property two).
 */
export const judgeParkGround = (raw: string): ParkGroundVerdict => {
  const ground = parseParkGround(raw);
  if (ground !== undefined) return { ok: true, ground };
  return {
    ok: false,
    reason: `--park-ground '${raw}' — this field names the FACT the park waits on, in a form the box can ask; the two forms it knows are 'frozen:<role>×<thread>' ("stands while that pair is frozen", ASCII '*' for the '×') and 'no-delivers-since:<thread>' ("stands while no letter in that thread carries 'delivers:'", counted from this park onwards). A ground it cannot read is a check that never runs, which is the silence this field was added to end (thread 155). Waiting for a person's decision needs no ground at all — leave the field off and the park behaves exactly as it always has`,
  };
};

/** A standing park that named its ground, and whether that ground is still there. */
export type GroundedPark = {
  readonly thread: string;
  readonly ground: ParkGround;
  /** The stamp of the message that declared the park — the identity of THIS declaration. */
  readonly since: string;
  /** Whose turn the park was declared on, when the declaring message named one. */
  readonly holder?: string;
  /** What the park stands behind (`john`, `pr:5`, …), quoted into the sentence. */
  readonly on: string;
};

/**
 * THE STANDING PARKS WHOSE GROUND HAS FALLEN AWAY — read from the same scan of the mail every
 * other park reading comes from, and from the frozen pairs the tick already holds.
 *
 * `frozenPairs` answers the one question of the one form: is that pair frozen right now. It is
 * passed in rather than read here so that this stays pure and so that the reader and the planner
 * cannot disagree about who is frozen — they are one map, computed once per tick.
 *
 * A GROUND THIS VERSION CANNOT READ IS SKIPPED IN SILENCE. The door refuses those, so one in the
 * feed is either older than this code or hand-written; either way the honest reading of it is
 * "no ground was named", which is the behaviour of every park without the field.
 */
export const groundsGone = (
  standing: readonly { readonly thread: string; readonly parking: Parking | undefined }[],
  input: {
    /** Keys of the pairs frozen right now — `pairKey(role, thread)`, as the tick builds them. */
    readonly frozen: ReadonlySet<string>;
    /** How a pair is keyed in that set; passed in to keep this module free of the orchestrator. */
    readonly key: (role: string, thread: string) => string;
    /**
     * DOES THAT THREAD CARRY A `delivers` LETTER STAMPED AFTER `since` — the one question of the
     * second form, answered by the caller out of the same scan of the mail the parks come from.
     *
     * `undefined` is "this box cannot ask": the named thread is not in the mail at all. It is a
     * SILENCE here and not a note, for the reason an unreadable ground is one — the reader of an
     * append-only feed repairs nothing, and "the thread you named does not exist" is a sentence
     * about a typo, which the door refuses at the moment it can still be retyped.
     */
    readonly deliveredSince: (thread: string, since: string) => boolean | undefined;
  },
): readonly GroundedPark[] => {
  const gone: GroundedPark[] = [];
  for (const { thread, parking } of standing) {
    if (parking?.ground === undefined) continue;
    const ground = parseParkGround(parking.ground);
    if (ground === undefined) continue;
    if (ground.kind === "frozen") {
      if (input.frozen.has(input.key(ground.role, ground.thread))) continue;
    } else if (input.deliveredSince(ground.thread, parking.since) !== true) continue;
    gone.push({
      thread,
      ground,
      since: parking.since,
      on:
        parking.kind === "person"
          ? (parking.person ?? "a person")
          : `${parking.kind === "run" ? "run" : "pr"}:${parking.pr}`,
      ...(parking.holder === undefined ? {} : { holder: parking.holder }),
    });
  }
  return gone;
};

/**
 * THE IDENTITY OF ONE SENTENCE — the park declaration, not the thread and not the fact.
 *
 * Keyed by the stamp of the declaring message, so a park put back after being lifted is a NEW
 * ground and is named again; and so a ground that flickers (a pair frozen, thawed, frozen again)
 * is named ONCE for that park and never repeats. The second half is the requirement: the price of
 * this feature is measured in sentences an operator actually reads.
 */
export const groundNoteKey = (gone: GroundedPark): string =>
  [gone.thread, gone.since, gone.ground.raw].join("\t");

/** What to say now, and what the caller must remember in order not to say it again. */
export type GroundNotes = {
  readonly say: readonly GroundedPark[];
  readonly seen: ReadonlySet<string>;
};

/**
 * ONCE PER TRANSITION (statement of work, §3.4) — the fold between two ticks.
 *
 * `seen` carries forward ONLY the keys still gone, so a park whose ground comes back and falls
 * away again is named a second time: that is a new transition and the operator has no other way
 * of learning about it. Keys of parks that have been lifted drop out by themselves, which is what
 * keeps this from growing without bound across a long-lived daemon.
 */
export const foldGroundNotes = (
  previous: ReadonlySet<string>,
  gone: readonly GroundedPark[],
): GroundNotes => {
  const seen = new Set<string>();
  const say: GroundedPark[] = [];
  for (const entry of gone) {
    const key = groundNoteKey(entry);
    seen.add(key);
    if (!previous.has(key)) say.push(entry);
  }
  return { say, seen };
};

/**
 * WHAT EXACTLY IS NO LONGER TRUE — one clause per form, and the clause is the whole difference
 * between the two sentences: everything around it is the same because the reader's question is
 * the same. Each one says the fact in the tense of NOW, so it can be checked by the hand that
 * reads it rather than believed.
 */
const groundIsGone = (ground: ParkGround): string =>
  ground.kind === "frozen"
    ? `the pair ${ground.role}×${ground.thread} is NOT frozen now`
    : `thread ${ground.thread} HAS a letter carrying 'delivers:' since then`;

/**
 * THE SENTENCE. It says the four things its reader needs and no diagnosis: which thread, what
 * the park declared it was waiting on, that the fact is no longer true, and that lifting it is
 * still a hand's job — the box does not lift a park and this line is not a claim that it did.
 */
export const describeGroundGone = (gone: GroundedPark): string =>
  `thread ${gone.thread}: THE GROUND OF THE PARK HAS FALLEN AWAY — it was declared ${
    gone.since
  } behind ${gone.on}${
    gone.holder === undefined ? "" : ` on the turn of ${gone.holder}`
  }, with 'park-ground: ${gone.ground.raw}', and ${groundIsGone(
    gone.ground,
  )}. The park still stands and still freezes this thread — nothing is lifted by this line — but the fact it was taken against is gone (thread 155). Read the thread and lift it by hand if nothing else holds it`;
