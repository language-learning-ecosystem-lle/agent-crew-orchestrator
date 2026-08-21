/**
 * The door that catches a park by MEANING which is not a park by FIELD (thread 022).
 *
 * The assertions bite into the TEXT rather than the return value: a refusal that does not name
 * the exit is a refusal the role cannot repair, and it is the wording — not the exit code — that
 * the raised session acts on.
 */
import { describe, expect, it } from "vitest";
import { judgeSelfTurn } from "./self-turn.js";

describe("judgeSelfTurn — a turn named as one's own, with nothing said about the wait", () => {
  it("REFUSES 'expects: ack' + a self-named turn, and names the exit that repairs it", () => {
    // The live header of `010-speech-service` on 2026-08-21, replayed: `expects: ack`,
    // `waiting-on: curator` from curator, no `parked-on`. Six of them, then `exhausted`.
    const verdict = judgeSelfTurn({ from: "curator", waitingOn: "curator", expects: "ack" });

    expect(verdict.ok).toBe(false);
    const reason = verdict.ok ? "" : verdict.reason;
    expect(reason).toContain("--parked-on <person>");
    expect(reason).toContain("no lawful outcome");
    // BOTH other exits are named too: the door must not pick between three different
    // statements for the author (the manner of 042 and 079).
    expect(reason).toContain("--waiting-on <role>");
    expect(reason).toContain("--expects none");
  });

  it("WARNS on 'expects: answer' + a self-named turn — the class is 173 messages of live form", () => {
    // Measured on 2026-08-21 in both mails: 173 such headers against 17 of the `ack` class.
    // Refusing it would block the everyday middle of a working thread to catch a minority.
    const verdict = judgeSelfTurn({ from: "dev-core", waitingOn: "dev-core", expects: "answer" });

    expect(verdict.ok).toBe(true);
    const warning = verdict.ok ? (verdict.warning ?? "") : "";
    expect(warning).toContain("--parked-on <person>");
    expect(warning).toContain("dev-core");
  });

  it("passes 'expects: none' + a self-named turn IN SILENCE — that is 'I am carrying on'", () => {
    // The regression curator required: the middle of a working thread must not learn a word.
    expect(judgeSelfTurn({ from: "curator", waitingOn: "curator", expects: "none" })).toEqual({
      ok: true,
    });
  });

  it("passes a turn handed to ANOTHER role in silence, whatever it expects", () => {
    // The door does not touch the handover of a turn — there the circuit knows who acts next.
    for (const expects of ["answer", "ack", "none"] as const) {
      expect(judgeSelfTurn({ from: "curator", waitingOn: "dev-core", expects })).toEqual({
        ok: true,
      });
    }
  });

  it("passes a header that already carries a park — the net of 020 does not move", () => {
    // The stitch with 020: the field this door exists to obtain is exactly what makes it silent.
    for (const parkedOn of ["john", "pr:127", "run:163"]) {
      expect(
        judgeSelfTurn({ from: "curator", waitingOn: "curator", expects: "ack", parkedOn }),
      ).toEqual({ ok: true });
    }
  });

  it("does not judge a header with no --waiting-on at all — that class belongs to 042 and 079", () => {
    // The turn stays with the author there too, but it is guessed at from two other doors
    // already, and a third reading of the same silence would be a rule nobody can name.
    expect(judgeSelfTurn({ from: "curator", expects: "ack" })).toEqual({ ok: true });
    expect(judgeSelfTurn({ from: "curator", waitingOn: null, expects: "ack" })).toEqual({
      ok: true,
    });
  });
});
