/**
 * A PARK BY MEANING THAT IS NOT A PARK BY FIELD (thread `022-parking-by-meaning`).
 *
 * Thread 020 built the whole recognition of a frozen turn on ONE field: a thread carrying
 * `parked-on` raises nobody and spends no attempt of the pair. The net is right, and it was
 * simply NOT FILLED IN where it was needed. The live case (mail of a consumer, thread
 * `010-speech-service`, six messages of 2026-08-21, `origin/comms` e2d7530):
 *
 *     from: curator / worker: unknown / date: 2026-08-21
 *     expects: ack / waiting-on: curator
 *
 * The body says "the turn came by the fact «the thread is waiting for curator»" and the role is
 * in fact waiting for a decision of a human — but the header, read by the norm of the role card,
 * says "I am carrying on by myself". The circuit reads the FIELD, not the meaning: it raised the
 * role again, and on the third tick the pair went `exhausted`. This is the freeze john diagnosed
 * by hand, and it is repaired at the WRITING door — the net of 020 cannot catch such a header by
 * construction, and must not try (its norm: the net is built on the fields of the header).
 *
 * WHAT THE STATE ACTUALLY IS. `expects: ack|answer` + `waiting-on: <the author itself>` + no
 * `parked-on` has no lawful outcome: there is nobody to answer (the turn is the author's), and
 * the only thing that can wake the author is the circuit — which wakes it, again and again,
 * until the ceiling of the pair is spent.
 *
 * WHY `ack` IS REFUSED AND `answer` IS ONLY WARNED ABOUT — a measurement, not a taste (point 1 of
 * curator's statement of work, both mails read on 2026-08-21):
 *
 * | class (self-named turn, no `parked-on`) | ACO mail | consumer mail | of it on 2026-08-21 |
 * | --- | --- | --- | --- |
 * | `expects: ack`    | 0  | 17  | 6 |
 * | `expects: answer` | 11 | 162 | 9 |
 *
 * The `ack` class is rare and, read by eye, has no lawful member: six of the seventeen are the
 * live freeze of 010 itself; `074-parked-on-norm` and `082-hetzner-migration` (08:30:53Z) ask
 * john for a decision and for his hands; the remaining eight report a pull request and wait for
 * a round or a button — which today is `--parked-on pr:N` / `run:N`. Asking for an acknowledgement
 * while holding one's own turn is the shape of the defect, so the door refuses it.
 *
 * The `answer` class is 173 messages across both mails and is the everyday middle of a working
 * thread — a role writing down where it got to while keeping its turn. Refusing it would block a
 * live form to catch a minority, so it is said out loud and written: the refusal repairs the
 * cause, the warning is read by the raised session it is addressed to, and neither guesses at the
 * author's meaning.
 *
 * WHAT IS DELIBERATELY NOT JUDGED HERE:
 *  · a message with NO `waiting-on` at all — the turn stays with the author there too, but that
 *    class belongs to the doors of 042 and 079 (a release that lives only in the prose, and
 *    `turn: explicit`), and this one must not start guessing at it from a second place;
 *  · the TEXT of the message (norm of 020: the net is built on the fields of the header);
 *  · `expects: none` + a self-named turn — the lawful "I am carrying on", the middle of a working
 *    thread, which passes in silence and has a regression of its own.
 */

import type { Expects } from "./message.js";

/** The verdict of the door: written in silence, written with a word, or refused with a reason. */
export type SelfTurnVerdict =
  | { readonly ok: true; readonly warning?: string }
  | { readonly ok: false; readonly reason: string };

/**
 * IS THIS HEADER A PARK THAT FORGOT TO SAY SO — the check at the writing door.
 *
 * Pure, so the WORDING is testable without a checkout: a refusal that does not name the exit is
 * a refusal the role cannot repair, and the exits are named in full — the park behind a person,
 * the park behind an event, the handover of the turn, and the working note that asks nothing.
 */
export const judgeSelfTurn = (input: {
  readonly from: string;
  /** As the header will carry it: `undefined` = no field, `null` = the turn released ('—'). */
  readonly waitingOn?: string | null | undefined;
  readonly expects: Expects;
  readonly parkedOn?: string;
}): SelfTurnVerdict => {
  // THE NET OF 020 IS UNTOUCHED: a header that says what it waits for is exactly what this door
  // exists to obtain, and it passes without a word whatever else it says.
  if (input.parkedOn !== undefined) return { ok: true };
  if (input.waitingOn !== input.from) return { ok: true };
  if (input.expects === "none") return { ok: true };
  const exits = `Say what the turn waits for: '--parked-on <person>' if it is a decision of a human (the thread then stands frozen, raises nobody and spends no attempt of the pair), '--parked-on pr:<number>' / 'run:<number>' if it is a merge or a round of CI, or '--waiting-on <role>' if somebody else acts next`;
  if (input.expects === "ack") {
    return {
      ok: false,
      reason: `'--expects ack' with '--waiting-on ${input.from}' and no --parked-on is a state with no lawful outcome: the turn is yours, so there is nobody to acknowledge it, and the only thing that can wake you is the circuit — which will, on every tick, until the ceiling of the pair is spent (thread 022; live case: six such headers in '010-speech-service' on 2026-08-21, and the pair went 'exhausted'). ${exits}. If this message asks for nothing, '--expects none' is the working note that passes in silence`,
    };
  }
  return {
    ok: true,
    warning: `this header keeps the turn with '${input.from}' and asks for an answer, and no --parked-on says what it is waiting for. If you are waiting for a person, the circuit does NOT know it: it will raise you again on every tick and the pair will end 'exhausted' (thread 022). ${exits}`,
  };
};
