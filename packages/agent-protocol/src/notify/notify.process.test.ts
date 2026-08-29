/**
 * The PROCESS test of `notify` — the notifier as a real command, with a real
 * transport plugin on the far side of the seam.
 *
 * What cannot be covered by the pure planner is exactly what this package's
 * expensive defects have always been made of: the ORDER of the three side effects
 * (resolve → write the state → send) and the resolution of everything the command is
 * given from outside. The transport here is a stub module named by an absolute path
 * in the config — which also proves the seam takes a module the core has never heard
 * of, since that is the whole claim of R4.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const ROLES = [
  { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  {
    id: "curator",
    kind: "claude.ai",
    status: "active",
    wake: { mode: "via-human", via: "john" },
    summary: "the keeper",
  },
  {
    id: "dev-core",
    kind: "claude-code",
    status: "active",
    wake: { mode: "watch", session: "s" },
    summary: "the stream",
  },
];

const meta = (participants: string): string =>
  `---\ntitle: T\nparticipants: ${participants}\nstatus: open\n---\n`;

const message = (from: string, waitingOn: string): string =>
  `---\nfrom: ${from}\nworker: human\ndate: 2026-07-25T20:00:00Z\nexpects: answer\nwaiting-on: ${waitingOn}\n---\n\nThe body.\n`;

/** A repository with a committed config, a mail root and a stub transport module. */
const contour = (options: {
  transport?: boolean;
  templates?: boolean;
  stalledAfter?: number;
  outcome?: "sent" | "failed" | "unconfigured";
}) => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-notify-"));
  const delivered = join(repo, "delivered.txt");
  const transportPath = join(repo, "stub-transport.mjs");
  writeFileSync(
    transportPath,
    [
      "import { writeFileSync } from 'node:fs';",
      "export const createTransport = ({ options, secrets }) => ({",
      "  send: async (text) => {",
      `    writeFileSync(${JSON.stringify(delivered)}, JSON.stringify({ text, options, token: secrets.TELEGRAM_BOT_TOKEN ?? null }));`,
      `    return { state: '${options.outcome ?? "sent"}', detail: 'stub: ${options.outcome ?? "sent"}' };`,
      "  },",
      "});",
      "",
    ].join("\n"),
  );

  const config = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    mail: { branch: "comms", dir: "agent-comms" },
    orchestrator: { state: ".orchestrator", mailCheckout: ".worktrees/comms", ref: "origin/main" },
    ...(options.transport === false
      ? {}
      : {
          notifications: {
            transport: { module: transportPath, options: { kind: "stub" } },
            ...(options.stalledAfter === undefined
              ? {}
              : { stalledAfterMinutes: options.stalledAfter }),
            ...(options.templates === false
              ? {}
              : {
                  templates: {
                    turn: "⏳ твой ход: {thread}",
                    "turn-with-nudge": "⏳ твой ход: {thread} ({nudged} следом)",
                    nudge: "🔔 тред {thread} ждёт {role} — дёрни его",
                  },
                }),
          },
        }),
    roles: ROLES,
  };
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);

  const root = join(repo, "agent-comms");
  /**
   * A thread FROZEN BEHIND JOHN, declared by a message that either asks or does not.
   *
   * `on` and `waitingOn` are the two knobs thread 031 needs: a park on somebody who is NOT a
   * notification target, on a thread whose turn stands where nothing else in the digest can be
   * said about it — the shape in which the courier's park counters used to go blind.
   */
  const park = (
    id: string,
    options: {
      asks: boolean;
      date?: string;
      body?: string;
      on?: string;
      waitingOn?: string;
    },
  ): void => {
    mkdirSync(join(root, id, "messages"), { recursive: true });
    writeFileSync(join(root, id, "_meta.md"), meta("dev-core, curator"));
    const date = options.date ?? "2026-07-25T20:00:00Z";
    writeFileSync(
      join(root, id, "messages", `${date.replace(/:/g, "-")}-curator.md`),
      `---\nfrom: curator\nworker: human\ndate: ${date}\nexpects: ${
        options.asks ? "answer" : "none"
      }\nwaiting-on: ${options.waitingOn ?? "curator"}\nparked-on: ${
        options.on ?? "john"
      }\n---\n\n${options.body ?? "Чинить ли гард 2?"}\n`,
    );
  };
  const thread = (id: string, waitingOn: string): void => {
    mkdirSync(join(root, id, "messages"), { recursive: true });
    writeFileSync(join(root, id, "_meta.md"), meta("dev-core, curator"));
    writeFileSync(
      join(root, id, "messages", "2026-07-25T20-00-00Z-dev-core.md"),
      message("dev-core", waitingOn),
    );
  };

  execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
  return {
    repo,
    root,
    delivered,
    state: join(repo, ".orchestrator", "notify.state"),
    thread,
    park,
    commit: (): void => {
      execFileSync("git", ["-C", repo, "add", "."]);
      execFileSync(
        "git",
        ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "init"],
        { encoding: "utf8" },
      );
    },
  };
};

const run = (
  contest: ReturnType<typeof contour>,
  extra: readonly string[] = [],
): { code: number; out: string } => {
  try {
    return {
      code: 0,
      out: execFileSync(
        TSX,
        [
          CLI,
          "notify",
          "--repo",
          contest.repo,
          "--root",
          contest.root,
          "--state",
          contest.state,
          "--ref",
          "HEAD",
          "--no-fetch",
          ...extra,
        ],
        { encoding: "utf8", stdio: "pipe", env: sandbox(configHomeInside(contest.repo)) },
      ),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("notify as a command", () => {
  it("without --write it prints what it would send and leaves the state alone", () => {
    // This is what `NOTIFY_DRY_RUN=1` used to be, folded into the package-wide rule.
    const contest = contour({});
    contest.thread("016-x", "john");
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("⏳ твой ход: 016-x");
    expect(existsSync(contest.state)).toBe(false);
    expect(existsSync(contest.delivered)).toBe(false);
  });

  it("--write delivers through the module named in the config, with its options and secrets", () => {
    const contest = contour({});
    contest.thread("016-x", "john");
    contest.commit();
    const envFile = join(contest.repo, "telegram.env");
    writeFileSync(envFile, "TELEGRAM_BOT_TOKEN=123:AA\n");

    const result = run(contest, ["--write", "--env-file", envFile]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("stub: sent");
    const payload = JSON.parse(readFileSync(contest.delivered, "utf8")) as {
      text: string;
      options: Record<string, string>;
      token: string | null;
    };
    expect(payload.text).toBe("⏳ твой ход: 016-x");
    expect(payload.options).toEqual({ kind: "stub" });
    // The secrets reach the plugin and NOTHING about them reaches the output.
    expect(payload.token).toBe("123:AA");
    expect(result.out).not.toContain("123:AA");
  });

  it("the second run says nothing: the trigger is a NEW pair, not the fact of waiting", () => {
    const contest = contour({});
    contest.thread("016-x", "john");
    contest.commit();

    run(contest, ["--write"]);
    const again = run(contest, ["--write"]);

    expect(again.out).toContain("nothing to announce");
  });

  it("a thread waiting on the assistant alone asks the human to poke them", () => {
    const contest = contour({});
    contest.thread("016-x", "curator");
    contest.commit();

    expect(run(contest).out).toContain("🔔 тред 016-x ждёт curator");
  });

  it("a thread waiting on an agent is not a notification at all — while it is moving", () => {
    // The horizon is put out of reach on purpose: the property being tested here is
    // the ORIGINAL one (a wait on an agent is the watch's business, not the phone's),
    // and the fixture is dated, so without this it would be caught by the second
    // question below rather than by the first.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.thread("016-x", "dev-core");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.out).toContain("0 waits");
    expect(existsSync(contest.delivered)).toBe(false);
  });

  it("...but the same thread standing still IS an event, with no human in waiting-on", () => {
    // The v13 case end to end: nobody is awaited who could be phoned, and the ring
    // happens anyway because the turn has not moved.
    const contest = contour({});
    contest.thread("016-x", "dev-core");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.out).toContain("0 waits");
    expect(result.out).toContain("stalled");
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain("has not moved for");
    expect(readFileSync(contest.state, "utf8")).toContain("stalled\tdev-core\t016-x\t");
  });

  it("a stall already announced is not announced again", () => {
    const contest = contour({});
    contest.thread("016-x", "dev-core");
    contest.commit();
    run(contest, ["--write"]);
    rmSync(contest.delivered);

    const again = run(contest, ["--write"]);

    expect(again.out).toContain("nothing to announce");
    expect(existsSync(contest.delivered)).toBe(false);
  });

  it("with no transport configured the message is printed and the state still moves", () => {
    const contest = contour({ transport: false });
    contest.thread("016-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("no transport configured");
    expect(result.out).toContain("your turn: 016-x");
    expect(existsSync(contest.state)).toBe(true);
  });

  it("a FAILED delivery is non-zero and leaves the state alone (thread 029)", () => {
    // The defect this closes, in the words of the run that produced it: notify said
    // "2 of them new", the transport said "fetch failed", the state was already on
    // disk — and the next call said "nothing to announce". john was never told.
    const contest = contour({ outcome: "failed" });
    contest.thread("029-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(1);
    expect(result.out).toContain("the state is unchanged");
    expect(existsSync(contest.state)).toBe(false);

    // And the proof that the trigger was not consumed: the next call announces it.
    const again = run(contest, ["--write"]);
    expect(again.out).toContain("1 of them new");
  });

  it("an UNCONFIGURED transport is silence, not a fault — zero, and the state stays put", () => {
    // No credentials on this box is a legitimate state (the rule inherited from
    // bin/notify.sh) — but it is not a delivery either, so nothing is marked
    // announced and credentials appearing later make it ring.
    const contest = contour({ outcome: "unconfigured" });
    contest.thread("029-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    expect(existsSync(contest.state)).toBe(false);
  });

  it("a pair that stops waiting is forgotten even though nothing was announced", () => {
    // "Nothing to announce" IS a confirmed outcome: the state moves, so a thread that
    // comes back to waiting later rings again instead of being remembered for ever.
    // The stalled horizon is put out of reach: the fixture is dated, and the second
    // question ("what has not moved") would otherwise turn the quiet run into an event.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.thread("016-x", "john");
    contest.commit();

    run(contest, ["--write"]);
    expect(readFileSync(contest.state, "utf8")).toContain("016-x");

    contest.thread("016-x", "dev-core"); // the turn moved on: nobody human is waiting
    const again = run(contest, ["--write"]);

    expect(again.out).toContain("nothing to announce");
    expect(readFileSync(contest.state, "utf8")).not.toContain("016-x");
  });

  it("A PARK RINGS ONCE — the next digest does not repeat the question (thread 051)", () => {
    // john's pain of 2026-08-03, end to end: the ❓ line used to be rendered from the
    // composition, so every digest with anything else in it carried the same question again.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("023-x", { asks: true });
    contest.commit();

    run(contest, ["--write"]);
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain(
      "your decision: 023-x — Чинить ли гард 2?",
    );
    rmSync(contest.delivered);

    // A NEW event on another thread — the digest goes out, and it is not about the park.
    contest.thread("016-x", "john");
    const second = run(contest, ["--write"]);

    expect(second.code).toBe(0);
    const text = JSON.parse(readFileSync(contest.delivered, "utf8")).text as string;
    expect(text).toContain("⏳ твой ход: 016-x");
    expect(text).not.toContain("023-x");
    // The park is still IN FORCE: it stays in the state, and the thread is not called stalled.
    expect(readFileSync(contest.state, "utf8")).toContain("parked\tjohn\t023-x\t");
    // AND THE LINE STAYS TRUE ABOUT IT (thread 030, Д-1): the question is still standing on
    // john, so it is still counted as asking — what is over is the RINGING, and that is the
    // third number. The old line said `0 of them asking` here, about a live question.
    expect(second.out).toContain("1 parked, 1 of them asking, 0 of those new");
  });

  it("A PARK WITH NOBODY TO CALL IS IN THE LINE, THOUGH IT RINGS NOBODY (thread 031)", () => {
    // THE DEFECT THROUGH THE REAL DOOR. `parked-on: curator` names a role whose `wake.mode` is
    // not `self`, so it is not a `direct` notification target — and the target filter used to
    // run BEFORE the counters, so the command printed `0 parked, 0 of them asking, 0 of those
    // new` about a live question. That is the line of an empty mail, and an operator reading it
    // decides there is nothing to look for; it is what thread 030 cost, in its second root.
    // The turn is left on dev-core (a `watch` role, not a target) so that nothing ELSE in the
    // digest can speak about this thread — the park is on its own here, as it was in the field.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("031-x", { asks: true, on: "curator", waitingOn: "dev-core" });
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    // The three numbers still speak only about the CALL, and there is none to make here...
    expect(result.out).toContain("0 parked, 0 of them asking, 0 of those new");
    // ...and the sixth clause is what tells this world from an empty mail, by name.
    expect(result.out).toContain("1 with nobody to call: 031-x (on curator, asking)");
    expect(result.out).toContain("nothing to announce");
    // NOTHING WAS RUNG AND NOTHING WAS REMEMBERED: the repair is the sentence, not a new call.
    // A park nobody was told about must not be recorded as told, or the day the config gains a
    // reachable person it would stay silent about a question that had never gone out.
    expect(existsSync(contest.delivered)).toBe(false);
    expect(readFileSync(contest.state, "utf8")).not.toContain("031-x");
  });

  it("a park declared by an informational message never rings, and no blank is sent", () => {
    // `expects: none` says the message asks nobody for anything. The park still freezes the
    // thread — so the wait line is suppressed too, and the whole digest renders to nothing.
    // A blank buzz on somebody's phone is not a delivery, and the state still moves.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("016-x", { asks: false, body: "фиксация мыслей, НЕ в работу" });
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("nothing to announce");
    expect(existsSync(contest.delivered)).toBe(false);
    expect(readFileSync(contest.state, "utf8")).toContain("parked\tjohn\t016-x\t");
  });

  it("THE SAME QUESTION ASKED AGAIN SENDS NOTHING — it waits for a letter (thread 030, Д-2)", () => {
    // The defect end to end, through the real command: a park is lifted by anybody's later
    // move, the raised role finds its question unanswered and writes it out again, and every
    // repeat used to be a second call on a human's phone. Two about aco-028 and two about
    // LLE-102 on 2026-08-21/22, one question each.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("023-x", { asks: true });
    contest.commit();
    run(contest, ["--write"]);
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain(
      "your decision: 023-x — Чинить ли гард 2?",
    );
    rmSync(contest.delivered);

    contest.park("023-x", { asks: true, date: "2026-07-26T09:00:00Z", body: "А теперь чинить?" });
    const again = run(contest, ["--write"]);

    // NO SECOND BUZZ: nothing was delivered at all, and the courier's line names the repeat
    // by its own number rather than passing it off as news.
    expect(existsSync(contest.delivered)).toBe(false);
    expect(again.out).toContain("1 parked, 1 of them asking, 0 of those new, 1 restated");
    expect(again.out).toContain("nothing to announce");
    // AND THE QUIET TICK DID NOT EAT THE REPEAT: the state still carries the stamp that was
    // ANNOUNCED, so the line is still owed. Recording the new stamp here would make the
    // downgrade a disappearance — the courier ticks every few minutes.
    expect(readFileSync(contest.state, "utf8")).toContain(
      "parked\tjohn\t023-x\t2026-07-25T20:00:00Z",
    );

    // A FRESH EVENT ELSEWHERE SENDS THE LETTER, AND THE REPEAT RIDES IN IT — the trigger of
    // the delivery and the composition of the message are two different things.
    contest.thread("016-x", "john");
    const third = run(contest, ["--write"]);

    const text = JSON.parse(readFileSync(contest.delivered, "utf8")).text as string;
    expect(text).toContain("⏳ твой ход: 016-x");
    expect(text).toContain(
      "still standing, asked again (not a new question): your decision: 023-x — А теперь чинить?",
    );
    expect(third.out).toContain("023-x (restated on john)");
    // Told at last, so the stamp moves — and the tick after this one is silent about it.
    expect(readFileSync(contest.state, "utf8")).toContain(
      "parked\tjohn\t023-x\t2026-07-26T09:00:00Z",
    );
  });

  it("A PARK LIFTED WITH NO ANSWER IS A LINE, AND THE LINE WAITS FOR A LETTER (thread 030, (в2))", () => {
    // The defect end to end, in the shape it was measured in on 2026-08-22: the park of john
    // on 030 was lifted by an automatic `github` message about the merge of #61 — a message
    // nobody wrote — and the thread left the courier's state ENTIRELY. Eight parks stood in
    // `.orchestrator/notify.state` that evening and the one question just asked was in none.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("030-x", { asks: true, body: "Сузить ли снятие парковки?" });
    contest.commit();
    run(contest, ["--write"]);
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain(
      "your decision: 030-x — Сузить ли снятие парковки?",
    );
    rmSync(contest.delivered);

    // THE LIFT, as the circuit performs it SINCE 2026-08-22 (thread 030, (в1)): the courier
    // declares `delivers: john` and the park goes. The automatic `github` message this case was
    // measured on — 'expects: none' with 'waiting-on: dev-core' — no longer lifts anything, and
    // that is the repair of (в1); what does NOT change is the courier's second question, which
    // is what this test is about: a key that WAS announced and has left the composition owes the
    // human a line instead of vanishing.
    writeFileSync(
      join(contest.root, "030-x", "messages", "2026-07-26T09-00-00Z-curator.md"),
      "---\nfrom: curator\nworker: claude-code\ndate: 2026-07-26T09:00:00Z\nexpects: none\n" +
        "waiting-on: dev-core\ndelivers: john\n---\n\nСлово john по вопросу.\n",
    );
    const lifted = run(contest, ["--write"]);

    // NO BUZZ: the lift rings for nobody — john's word was "a line of the digest".
    expect(existsSync(contest.delivered)).toBe(false);
    expect(lifted.out).toContain("0 parked, 0 of them asking, 0 of those new, 1 lifted");
    expect(lifted.out).toContain("nothing to announce");
    // AND THE QUIET TICK DID NOT EAT IT: the key stays in the state with the stamp that was
    // announced, because the line has not actually gone anywhere yet.
    expect(readFileSync(contest.state, "utf8")).toContain(
      "parked\tjohn\t030-x\t2026-07-25T20:00:00Z",
    );

    // A FRESH EVENT ELSEWHERE SENDS THE LETTER, AND THE LINE RIDES IN IT.
    contest.thread("016-y", "john");
    const letter = run(contest, ["--write"]);

    const text = JSON.parse(readFileSync(contest.delivered, "utf8")).text as string;
    expect(text).toContain("⏳ твой ход: 016-y");
    // THE COURIER DOES NOT CLAIM THE ANSWER WAS NOT NAMED ((в1), 2026-08-22): the park was
    // lifted by `delivers: john` — the answer was named, by the field that did the lifting —
    // and the line says only what it measured, that the key rang and has stopped standing.
    expect(text).toContain(
      "the park was lifted, the last line about the question: " +
        "your decision: 030-x — Сузить ли снятие парковки?",
    );
    expect(text).not.toContain("no answer named");
    expect(letter.out).toContain("030-x (lifted on john)");
    // Told at last, so the key leaves the state — and the tick after it says nothing again.
    expect(readFileSync(contest.state, "utf8")).not.toContain("030-x");
    rmSync(contest.delivered);

    const after = run(contest, ["--write"]);

    expect(existsSync(contest.delivered)).toBe(false);
    expect(after.out).not.toContain("lifted");
  });

  it("THE LIFTED PARK AND THE PARK WITH NOBODY TO CALL MEET IN ONE LINE (threads 030 + 031)", () => {
    // THE SEAM BETWEEN THE TWO REPAIRS, and the only thing merging their branches could break
    // silently: both grew a clause of the same sentence and both are read off the same park
    // composition, so the question is whether one park can ever fall into both counts — or be
    // eaten by the other's filter. It cannot, and this is the measurement that says so rather
    // than the argument: a park nobody can be called about is never written into the state as
    // announced, so it can never come back as a lift; a park that DID ring is not in the
    // unaddressed count, because its person is a target. Here they stand side by side in one
    // tick, and the line carries both numbers with the three about the call still true.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("030-x", { asks: true, body: "Сузить ли снятие парковки?" });
    contest.park("031-x", { asks: true, on: "curator", waitingOn: "dev-core" });
    contest.commit();

    const first = run(contest, ["--write"]);

    // The call is john's alone, and the park with nobody to call is beside it, not inside it.
    expect(first.out).toContain(
      "1 parked, 1 of them asking, 1 of those new, 1 with nobody to call: 031-x (on curator, asking)",
    );
    expect(JSON.parse(readFileSync(contest.delivered, "utf8")).text).toContain(
      "your decision: 030-x — Сузить ли снятие парковки?",
    );
    // ONLY THE PARK THAT RANG IS REMEMBERED — this is what keeps 031 out of the lift count.
    expect(readFileSync(contest.state, "utf8")).toContain("parked\tjohn\t030-x\t");
    expect(readFileSync(contest.state, "utf8")).not.toContain("031-x");
    rmSync(contest.delivered);

    // THE LIFT of john's park — while 031 keeps standing untouched. The lift is the DELIVERY
    // ((в1), 2026-08-22): this fixture used to lift the park with an automatic `github` message,
    // and that class stopped lifting anything on the day the person park was narrowed. The seam
    // this test measures is not the lift but what the two repairs do to one composition, so the
    // fixture follows the norm and the two clauses stay side by side, as they were written.
    writeFileSync(
      join(contest.root, "030-x", "messages", "2026-07-26T09-00-00Z-curator.md"),
      "---\nfrom: curator\nworker: claude-code\ndate: 2026-07-26T09:00:00Z\nexpects: none\n" +
        "waiting-on: dev-core\ndelivers: john\n---\n\nСлово john по вопросу.\n",
    );
    const both = run(contest, ["--write"]);

    // BOTH CLAUSES IN ONE SENTENCE, in the order they are printed: the fifth about a park that
    // rang and stopped standing, the sixth about a park that never rang at all.
    expect(both.out).toContain(
      "0 parked, 0 of them asking, 0 of those new, 1 lifted, " +
        "1 with nobody to call: 031-x (on curator, asking)",
    );
    // Neither rings: the lift owes a line, the unaddressed park has nobody to ring.
    expect(existsSync(contest.delivered)).toBe(false);
    expect(both.out).toContain("nothing to announce");
    // The lift stays owed in the state; 031 is still not written, tick after tick.
    expect(readFileSync(contest.state, "utf8")).toContain(
      "parked\tjohn\t030-x\t2026-07-25T20:00:00Z",
    );
    expect(readFileSync(contest.state, "utf8")).not.toContain("031-x");
  });

  it("a CLOSED thread's lifted park says nothing and does not linger (thread 030, (в2))", () => {
    // Closing a thread IS the acceptance: the question inside it is answered by construction,
    // and a line about it would be the courier arguing with the person who closed it.
    const contest = contour({ stalledAfter: 10_000_000 });
    contest.park("030-z", { asks: true });
    contest.commit();
    run(contest, ["--write"]);
    rmSync(contest.delivered);

    writeFileSync(
      join(contest.root, "030-z", "_meta.md"),
      "---\ntitle: T\nparticipants: dev-core, curator\nstatus: closed\n---\n",
    );
    const closed = run(contest, ["--write"]);

    expect(existsSync(contest.delivered)).toBe(false);
    expect(closed.out).not.toContain("lifted");
    expect(readFileSync(contest.state, "utf8")).not.toContain("030-z");
  });

  it("a transport that does not load REFUSES before the state is touched", () => {
    // Otherwise a setup defect would consume the trigger: the pair would be marked
    // as reported and never announced again.
    const contest = contour({});
    writeFileSync(
      join(contest.repo, "agent-protocol.json"),
      readFileSync(join(contest.repo, "agent-protocol.json"), "utf8").replace(
        /"module": "[^"]*"/,
        '"module": "no-such-transport-anywhere"',
      ),
    );
    contest.thread("016-x", "john");
    contest.commit();

    const result = run(contest, ["--write"]);

    expect(result.code).toBe(2);
    expect(existsSync(contest.state)).toBe(false);
  });
});

/**
 * THE SEAM OF THE EIGHTH CLASS (thread 042) — the mail says a turn passed, the JOURNAL says
 * whether a session was ever raised for it, and no unit over either half can check that they
 * are read as one fact. This is the only category built from both.
 */
describe("a turn this box never took — notify against the journal (thread 042)", () => {
  /** A thread whose last word hands the turn to a role THIS box raises, at `date`. */
  const handedTo = (contest: ReturnType<typeof contour>, id: string, date: string): void => {
    mkdirSync(join(contest.root, id, "messages"), { recursive: true });
    writeFileSync(join(contest.root, id, "_meta.md"), meta("dev-core, curator"));
    writeFileSync(
      join(contest.root, id, "messages", `${date.replace(/:/g, "-")}-curator.md`),
      `---\nfrom: curator\nworker: human\ndate: ${date}\nexpects: answer\nwaiting-on: dev-core\n---\n\nПостановка.\n`,
    );
  };
  /**
   * The fixture's `dev-core` made RAISEABLE by this box: only a role the box actually launches
   * can be judged untaken (`launchScopeFrom`), and a turn standing on somebody else's role is
   * that box's business. The shared ROLES above carry no launch profile on purpose — the rest
   * of this file tests the courier, which does not care.
   */
  const raiseable = (contest: ReturnType<typeof contour>): void => {
    const path = join(contest.repo, "agent-protocol.json");
    const config = JSON.parse(readFileSync(path, "utf8")) as {
      roles: { id: string; instructions?: unknown; launch?: unknown }[];
    };
    for (const role of config.roles) {
      if (role.id !== "dev-core") continue;
      role.instructions = [{ kind: "in-repo", path: "CARD.md" }];
      role.launch = { allowedTools: ["Bash"] };
    }
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(join(contest.repo, "CARD.md"), "# dev-core\n");
  };
  /** A journal stamp, as the schema wants it: UTC ISO, no milliseconds. */
  const stamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;
  /** The box's own state: launches ON (so no box-wide reason answers for the pair) and a journal. */
  const box = (contest: ReturnType<typeof contour>, events: readonly unknown[]): void => {
    const state = join(contest.repo, ".orchestrator");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "enabled"), "", "utf8");
    writeFileSync(
      join(state, "journal.jsonl"),
      events
        .map((event) => JSON.stringify(event))
        .join("\n")
        .concat("\n"),
      "utf8",
    );
  };

  it("no lease for the pair since the handoff — the line names it and the call goes out", () => {
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    box(contest, [
      // A lease of the SAME role on ANOTHER thread, and one of the same pair from BEFORE the
      // handoff: neither is this turn being taken, and a rule that asked "was it ever raised"
      // would call the pair healthy for good.
      {
        kind: "lease-acquired",
        ts: "2026-07-25T19:00:00Z",
        role: "dev-core",
        thread: "042-untaken",
        deadline: "2026-07-25T20:00:00Z",
      },
      {
        kind: "lease-released",
        ts: "2026-07-25T19:30:00Z",
        role: "dev-core",
        thread: "042-untaken",
        reason: "completed",
      },
      {
        kind: "lease-acquired",
        ts: "2026-07-26T09:00:00Z",
        role: "dev-core",
        thread: "016-other",
        deadline: "2026-07-26T10:00:00Z",
      },
      {
        kind: "lease-released",
        ts: "2026-07-26T09:30:00Z",
        role: "dev-core",
        thread: "016-other",
        reason: "completed",
      },
    ]);
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("unaccepted over 10m");
    expect(result.out).toContain("dev-core×042-untaken");
    expect(result.out).toContain("no reason known");
    // And the call itself — the box's own voice, with the instruction the reader needs.
    expect(result.out).toContain("this box has not raised it");
  });

  it("a lease AFTER the handoff is the turn being taken — nothing is said", () => {
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    box(contest, [
      {
        kind: "lease-acquired",
        ts: "2026-07-25T20:00:23Z",
        role: "dev-core",
        thread: "042-untaken",
        deadline: "2026-07-25T21:00:00Z",
      },
    ]);
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("unaccepted over 10m");
  });

  it("launches switched off is a REASON: printed with it, and no call", () => {
    // The box working exactly as its operator set it up. A ring here is the noise that
    // teaches a reader to stop reading the digest.
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    const state = join(contest.repo, ".orchestrator");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "journal.jsonl"), "", "utf8");
    contest.commit();

    const result = run(contest);

    expect(result.out).toContain("dev-core×042-untaken");
    expect(result.out).toContain("launches are disabled on this box");
    expect(result.out).not.toContain("this box has not raised it");
  });

  /** A hold file as `orchestrator hold` writes it: `<state>/holds/<role>`, one JSON line. */
  const heldBy = (contest: ReturnType<typeof contour>, expires: string): void => {
    const dir = join(contest.repo, ".orchestrator", "holds");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "dev-core"),
      `${JSON.stringify({ role: "dev-core", by: "john", taken: "2026-07-25T19:00:00Z", expires })}\n`,
      "utf8",
    );
  };
  /** A journal that says nothing about the pair — the turn is untaken, and the box is on. */
  const idle = (contest: ReturnType<typeof contour>): void =>
    box(contest, [
      {
        kind: "lease-acquired",
        ts: "2026-07-25T19:00:00Z",
        role: "curator",
        thread: "016-other",
        deadline: "2026-07-25T20:00:00Z",
      },
      {
        kind: "lease-released",
        ts: "2026-07-25T19:30:00Z",
        role: "curator",
        thread: "016-other",
        reason: "completed",
      },
    ]);

  it("a role HELD by a manual session is a REASON: printed with it, and no call", () => {
    // S5, and the daemon's own words for the same pair every tick: `candidate … skipped: held
    // by a manual session of dev-core`. The box is doing what a human told it to do, and a ring
    // here would send john to look at a daemon for a hold he took himself.
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    idle(contest);
    heldBy(contest, "2099-01-01T00:00:00Z");
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("dev-core×042-untaken");
    expect(result.out).toContain("held by a manual session of john");
    expect(result.out).not.toContain("no reason known");
    expect(result.out).not.toContain("this box has not raised it");
  });

  it("an EXPIRED hold is no reason at all — the pair rings", () => {
    // The other half, and the one that makes the first honest: an expired hold is raised over
    // by the daemon, so a pair still standing behind one is the standstill nobody was told
    // about. Curing the false call by going mute would be the worse defect of the two.
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    idle(contest);
    heldBy(contest, "2026-07-25T20:05:00Z");
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("unaccepted over 10m");
    expect(result.out).toContain("dev-core×042-untaken");
    expect(result.out).toContain("no reason known");
    expect(result.out).toContain("this box has not raised it");
  });

  it("a queue behind the role's OWN other thread does not ring when it ends", () => {
    // THE FIRST FIELD FIRING OF THIS CLASS, END TO END THROUGH THE COMMAND, and it was false:
    // `.orchestrator/daemon.log:30783` of 2026-08-29T02:53:11Z rang about
    // `curator×042-unaccepted-turn-silent (14m, no reason known)` six seconds before that very
    // pair was raised, because thirteen of the fourteen minutes were the role's own lease on
    // `026-codex-agent-kind`. The stamps below are those journal records, rebased on the clock
    // this test runs at: the lease covers the standing time up to a minute ago.
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    box(contest, [
      {
        kind: "lease-acquired",
        ts: "2026-07-25T19:58:14Z",
        role: "dev-core",
        thread: "026-other",
        deadline: "2026-07-26T00:00:00Z",
      },
      {
        kind: "lease-released",
        ts: stamp(Date.now() - 60_000),
        role: "dev-core",
        thread: "026-other",
        reason: "completed",
      },
    ]);
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("unaccepted over 10m");
    expect(result.out).not.toContain("this box has not raised it");
  });

  it("…and once the role has been free past the threshold, the same pair rings", () => {
    // The other half of the same seam: the queue is subtracted, not the standstill. Same
    // fixture, the lease released half an hour ago and nobody raised the pair since.
    const contest = contour({});
    raiseable(contest);
    handedTo(contest, "042-untaken", "2026-07-25T20:00:00Z");
    box(contest, [
      {
        kind: "lease-acquired",
        ts: "2026-07-25T19:58:14Z",
        role: "dev-core",
        thread: "026-other",
        deadline: "2026-07-26T00:00:00Z",
      },
      {
        kind: "lease-released",
        ts: stamp(Date.now() - 30 * 60_000),
        role: "dev-core",
        thread: "026-other",
        reason: "completed",
      },
    ]);
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("unaccepted over 10m");
    expect(result.out).toContain("dev-core×042-untaken");
  });

  it("a park declared on ANOTHER role's turn does not freeze the thread at all (thread 042)", () => {
    // The measured window of 2026-08-28, end to end through the command: a park put up on
    // curator's turn, the turn handed to dev-core two minutes later, and 4 h 16 m of silence
    // while the daemon printed `PARKED behind a decision of john` at every tick.
    //
    // UNTIL THE LIFT OF 2026-08-29 THE COURIER WAS THE ONLY ONE WHO KNEW: the park stood, the
    // scheduler kept skipping the pair, and this line rang about a pair frozen behind a decision
    // that was not its own. Now the freeze itself is gone — `parkingOf` reads the park against
    // the turn it was declared on — so the courier has nothing to explain away: the counters say
    // `0 parked`, and what is left is the plain untaken turn the box owes a raise.
    const contest = contour({});
    raiseable(contest);
    contest.park("010-speech", { asks: true, date: "2026-07-25T19:58:00Z", waitingOn: "curator" });
    writeFileSync(
      join(contest.root, "010-speech", "messages", "2026-07-25T20-00-00Z-curator.md"),
      `---\nfrom: curator\nworker: human\ndate: 2026-07-25T20:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nДержи ход.\n`,
    );
    box(contest, []);
    contest.commit();

    const result = run(contest);

    expect(result.out).toContain("dev-core×010-speech");
    expect(result.out).toContain("0 parked, 0 of them asking, 0 of those new");
    // AND THE SENTENCES OF THE FREEZE ARE ABSENT, both of them: the pair is not behind a park,
    // and the courier's strap for a park it merely inherited has nothing to fire on here.
    expect(result.out).not.toContain("behind a park on john");
    expect(result.out).not.toContain("declared on another role's turn");
  });

  it("AT THE SAME HOLDER THE PARK STILL FREEZES THE THREAD — the pair is not owed a raise", () => {
    // The other half of the same door, and the reason it has to be measured through the command:
    // a park whose turn never left the role that declared it is a legal freeze, and the ten of
    // them standing in the field on the day this shipped must not become ten calls. The report
    // of another role at the same holder (`042`, `03-36-47Z-dev-core.md`) is exactly the class
    // the narrowing of 22.08 bought, and it leaves the park where it is.
    const contest = contour({});
    raiseable(contest);
    contest.park("016-mode", { asks: true, date: "2026-07-25T19:58:00Z", waitingOn: "curator" });
    writeFileSync(
      join(contest.root, "016-mode", "messages", "2026-07-25T20-00-00Z-dev-core.md"),
      `---\nfrom: dev-core\nworker: human\ndate: 2026-07-25T20:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nДоклад роли.\n`,
    );
    box(contest, []);
    contest.commit();

    const result = run(contest);

    expect(result.out).toContain("1 parked, 1 of them asking");
    expect(result.out).toContain("016-mode");
    // Nothing is owed a raise here: a frozen thread is not an untaken turn.
    expect(result.out).not.toContain("dev-core×016-mode");
  });
  /**
   * A park DECLARED ON THIS PAIR'S TURN and then LIFTED by the word of john, `ago` ms back.
   * Both halves are the field's own headers (`042`, 2026-08-29): `parked-on: john` with
   * `waiting-on: <the pair's role>`, and the courier's lift `delivers: john` that keeps the
   * turn where it was — the handoff, and therefore the age, stays the park's own stamp.
   */
  const liftedPark = (contest: ReturnType<typeof contour>, id: string, ago: number): void => {
    contest.park(id, { asks: true, date: "2026-07-25T19:58:00Z", waitingOn: "dev-core" });
    const date = stamp(Date.now() - ago);
    writeFileSync(
      join(contest.root, id, "messages", `${date.replace(/:/g, "-")}-curator.md`),
      `---\nfrom: curator\nworker: human\ndate: ${date}\nexpects: none\ndelivers: john\nwaiting-on: dev-core\n---\n\nJohn ответил: вариант D.\n`,
    );
  };

  it("a park LIFTED A MINUTE AGO does not ring — the false call of 2026-08-29T10:05Z, end to end", () => {
    // THE THIRD FALSE FIRING OF THIS CLASS, through the real command. `daemon.log:19561`:
    // `1 unaccepted over 10m, 1 the box cannot justify, 1 of those new —
    // curator×042-unaccepted-turn-silent (6h 37m, no reason known)`, rung at ~10:05Z about a
    // pair that had stood under a park on john since 03:27:44Z — 742 ticks of `skipped: the
    // turn is parked behind a decision of john` — and was raised 39 seconds later. The park is
    // in the MAIL and in nothing else, which is why the juncture has to be measured here: the
    // journal the unit tests fold has never heard of a park.
    const contest = contour({});
    raiseable(contest);
    liftedPark(contest, "042-untaken", 60_000);
    box(contest, []);
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).not.toContain("unaccepted over 10m");
    expect(result.out).not.toContain("this box has not raised it");
    // And the park is gone from the composition too — it was lifted, and the silence above is
    // the subtracted interval, not a park still standing in front of the class.
    expect(result.out).toContain("0 parked, 0 of them asking");
  });

  it("…and once the pair has been FREE past the threshold, it rings with the free age", () => {
    // The other half of the same seam, and the requirement the statement put in bold: curing
    // the false call by silence would be the worse of the two defects. Thirty minutes after the
    // lift nobody has raised the pair, and the number in the line is that free part — not the
    // year of wall-clock standing time the fixture's handoff carries.
    const contest = contour({});
    raiseable(contest);
    liftedPark(contest, "042-untaken", 30 * 60_000 + 30_000);
    box(contest, []);
    contest.commit();

    const result = run(contest);

    expect(result.code).toBe(0);
    expect(result.out).toContain("unaccepted over 10m");
    expect(result.out).toContain("dev-core×042-untaken (30m, no reason known)");
    expect(result.out).toContain("this box has not raised it");
  });
});
