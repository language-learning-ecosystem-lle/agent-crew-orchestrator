/**
 * THE SEAM OF THE NUMBER WATCHMAN (thread `159-thread-number-has-no-door`, curator's
 * acceptance of 2026-09-08, msg-007 §1) — the two facts the units beside the criterion
 * cannot hold.
 *
 * `thread-number-collision.test.ts` proves WHICH letter a set of threads produces and that
 * the mark survives `renderNotifyState` → `parseNotifyState`. It proves nothing about
 * whether the argv it builds is one `new-message` accepts, whether the letter reaches a
 * feed a reader of the mail sees, or whether the mark the courier writes into
 * `notify.state` is the one the courier reads back on the NEXT tick — every one of them
 * builds its own expectation of the door and none of them ever calls it.
 *
 * And the direction that gap fails in is the silent one, which is why it is worth a
 * process test: a watchman whose lock does not hold looks like a working watchman and
 * fills a receiver a human reads with one letter per tick — thread
 * `133-tidy-letter-repeats-every-tick` again, ticks being a minute apart.
 *
 * So the cases here run the REAL path: a real contour, a real mail checkout with an origin
 * to push into, `notify --write` as a command, and the letter read back out of the feed
 * with `thread show` — not off the disk, because "a file was written" and "a reader of the
 * thread sees it" are two different statements.
 *
 *  1. TWO TICKS over the same live pair deliver EXACTLY ONE letter, and it lands in the
 *     standing address with the turn on curator;
 *  2. the mark is LIFTED by the pair ceasing to satisfy the criterion — and the same pair
 *     coming back rings a second time;
 *  3. A DELIVERED DIGEST DOES NOT TAKE THE MARK WITH IT — the field defect of 2026-09-09,
 *     and the case the first two could not see. Both of them pass on the broken code:
 *     without `notifications.transport` the contour never reaches the branch of `runNotify`
 *     that a sent digest takes, and that branch was the one writer of four that rebuilt
 *     `notify.state` without the watchman's marks. Seventeen identical letters about pair
 *     `180` in four hours are what a fixture-green lock looks like from the field.
 *
 * The live pair is built by a FIXTURE and not taken from the feed: the only pair that was
 * ever live on `origin/comms` (`170`, measured in this thread) went quiet at 12:00:06Z on
 * 2026-09-08, and a test that read the real mail would be a test of what somebody has not
 * closed yet.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHome, sandbox } from "../testing/process-sandbox.js";
import { NUMBER_COLLISION_SLUG } from "./thread-number-collision.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

/**
 * The roles the letter names. `github` signs it and `curator` is handed the turn — the
 * door of `new-message` checks both against the config, so both have to exist here.
 */
const ROLES = [
  {
    id: "github",
    kind: "github-actions",
    status: "active",
    wake: { mode: "event" },
    summary: "the circuit's machine notifier",
  },
  {
    id: "curator",
    kind: "claude-code",
    status: "active",
    wake: { mode: "watch", session: "c" },
    summary: "the coordinator",
  },
  {
    id: "dev-core",
    kind: "claude-code",
    status: "active",
    wake: { mode: "watch", session: "s" },
    summary: "the stream",
  },
];

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: {
    state: ".orchestrator",
    mailCheckout: "mailco",
    ref: "HEAD",
    workdir: { branch: "main", worktrees: ".worktrees" },
  },
  roles: ROLES,
};

const meta = (status: "open" | "closed"): string =>
  `---\ntitle: T\nparticipants: dev-core, curator\nstatus: ${status}\n---\n`;

const MESSAGE =
  "---\nfrom: curator\nworker: human\ndate: 2026-07-25T20:00:00Z\nexpects: none\nwaiting-on: —\n---\n\nThe body.\n";

/**
 * A MESSAGE THAT LEAVES A TURN STANDING — the one thing that makes the courier's DIGEST go
 * out at all. Without it every tick of this fixture is `quiet`, and `quiet` is not the
 * branch the field runs: the box announces waits, and it is the announcement that used to
 * take the watchman's marks down with it.
 */
const WAITING_MESSAGE =
  "---\nfrom: dev-core\nworker: claude-code\ndate: 2026-07-25T20:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nSomebody is waiting.\n";

type Contour = {
  readonly repo: string;
  readonly mail: string;
  readonly state: string;
  /**
   * Writes (or rewrites) a thread into the mail checkout and pushes it into the feed.
   * `waiting` is `open` plus a turn standing on curator — see {@link WAITING_MESSAGE}.
   */
  readonly feed: (threads: Readonly<Record<string, "open" | "closed" | "waiting">>) => void;
};

/**
 * A contour with a mail checkout that has somewhere to push — the shape
 * `tidy-letter.process.test.ts` builds, because the delivery under test is the same one:
 * a child `new-message --ensure-thread … --write` that commits and pushes.
 */
const contour = (options: { readonly transport?: boolean } = {}): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-collision-seam-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  // A TRANSPORT THAT DELIVERS, and it is the whole point of the third case below: a digest
  // that goes out takes a branch of `runNotify` a contour without one never reaches. The
  // stub is the one `notify.process.test.ts` uses — a module named by absolute path.
  const transportPath = join(repo, "stub-transport.mjs");
  if (options.transport === true)
    writeFileSync(
      transportPath,
      [
        "export const createTransport = () => ({",
        "  send: async () => ({ state: 'sent', detail: 'stub: sent' }),",
        "});",
        "",
      ].join("\n"),
    );
  const config =
    options.transport === true
      ? { ...CONFIG, notifications: { transport: { module: transportPath, options: {} } } }
      : CONFIG;
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(config, null, 2)}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "config");
  git(repo, "push", "-q", "origin", "main");

  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const feed = (threads: Readonly<Record<string, "open" | "closed" | "waiting">>): void => {
    for (const [id, status] of Object.entries(threads)) {
      const dir = join(mail, "agent-comms", id);
      mkdirSync(join(dir, "messages"), { recursive: true });
      writeFileSync(join(dir, "_meta.md"), meta(status === "waiting" ? "open" : status));
      writeFileSync(
        join(
          dir,
          "messages",
          status === "waiting"
            ? "2026-07-25T20-00-00Z-dev-core.md"
            : "2026-07-25T20-00-00Z-curator.md",
        ),
        status === "waiting" ? WAITING_MESSAGE : MESSAGE,
      );
    }
    git(mail, "add", "agent-comms");
    git(mail, "commit", "-qm", "mail");
    git(mail, "push", "-q", "-u", "origin", "comms");
  };
  feed({ "012-x": "open" });
  return { repo, mail, state: join(repo, ".orchestrator", "notify.state"), feed };
};

/** One tick of the courier, exactly as the daemon runs it. */
const tick = (contest: Contour): { code: number; out: string } => {
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
          join(contest.mail, "agent-comms"),
          "--state",
          contest.state,
          "--ref",
          "HEAD",
          "--no-fetch",
          "--write",
        ],
        {
          cwd: contest.repo,
          encoding: "utf8",
          stdio: "pipe",
          env: sandbox(configHome(contest.repo)),
        },
      ),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

/** The receiver of the standing address, as it stands in the feed — or nothing. */
const receiverOf = (contest: Contour): string | undefined =>
  readdirSync(join(contest.mail, "agent-comms")).find((entry) =>
    entry.endsWith(`-${NUMBER_COLLISION_SLUG}`),
  );

/**
 * HOW MANY LETTERS STAND IN THE ADDRESS — counted as FILES over EVERY receiver of it, the
 * measure of thread 133: a lock that let the second letter open a SECOND receiver would
 * leave the first one at exactly one message and pass a test that looked at one folder.
 */
const lettersIn = (contest: Contour): number =>
  readdirSync(join(contest.mail, "agent-comms"))
    .filter((entry) => entry.endsWith(`-${NUMBER_COLLISION_SLUG}`))
    .reduce(
      (total, entry) =>
        total +
        readdirSync(join(contest.mail, "agent-comms", entry, "messages")).filter((name) =>
          name.endsWith(".md"),
        ).length,
      0,
    );

/**
 * THE LETTER AS A READER OF THE THREAD SEES IT. Not `readFileSync` on the message: the
 * claim under test is that the letter ARRIVED, and a file in a directory the loader
 * rejects — a bad header, a sender the registry does not know — is a file, not an arrival.
 */
const readBack = (contest: Contour, thread: string): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "thread",
      "show",
      "--root",
      join(contest.mail, "agent-comms"),
      "--repo",
      contest.repo,
      "--ref",
      "HEAD",
      "--thread",
      thread,
    ],
    { cwd: contest.repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(contest.repo)) },
  );

/**
 * WHOSE TURN THE FEED SAYS IT IS, read by the queue's own reader rather than off the
 * message: `mail --role <id>` is literally what the tick consults to decide whom to raise,
 * so a letter this does not surface raises nobody — and a finding that raises nobody is the
 * `severity: note` answer rejected at the start of thread 159.
 */
const turnsOf = (contest: Contour, role: string): string =>
  execFileSync(
    TSX,
    [
      CLI,
      "mail",
      "--root",
      join(contest.mail, "agent-comms"),
      "--repo",
      contest.repo,
      "--ref",
      "HEAD",
      "--role",
      role,
    ],
    { cwd: contest.repo, encoding: "utf8", stdio: "pipe", env: sandbox(configHome(contest.repo)) },
  );

/** The marks the state file carries — read as the next tick reads them. */
const marksIn = (contest: Contour): readonly string[] =>
  (existsSync(contest.state) ? readFileSync(contest.state, "utf8") : "")
    .split("\n")
    .filter((line) => line.startsWith("number-collision\t"))
    .map((line) => line.split("\t")[1] as string);

describe("the watchman of thread numbers, end to end", () => {
  it("TWO TICKS over one live pair deliver EXACTLY ONE letter, into the standing address", () => {
    const contest = contour();
    // The pair: two directories under `159`, one of them open. This is the criterion's
    // whole input, and it is a fixture because the live pair on the real feed is gone.
    contest.feed({ "159-a-thread-that-was-first": "closed", "159-a-namesake": "open" });

    const first = tick(contest);
    expect(first.code).toBe(0);
    expect(lettersIn(contest)).toBe(1);

    const receiver = receiverOf(contest);
    expect(receiver).toBeDefined();
    // The letter ARRIVED — read by the reader of the mail, and naming both halves and
    // which of them is open, which is requirement 7 of the statement of work.
    const shown = readBack(contest, receiver as string);
    expect(shown).toContain("159-a-namesake");
    expect(shown).toContain("159-a-thread-that-was-first");
    expect(shown).toContain("from: github");
    // The turn, as the queue's own reader sees it: this letter raises curator.
    expect(turnsOf(contest, "curator")).toContain(receiver as string);
    // The mark went into the state file at the moment the letter landed.
    expect(marksIn(contest)).toEqual(["number:159:159-a-namesake,159-a-thread-that-was-first"]);

    // THE SECOND TICK — the same feed, the same live pair, the state file of the first.
    const second = tick(contest);
    expect(second.code).toBe(0);
    expect(lettersIn(contest)).toBe(1);
    // And the tick did not go silent about the pair by forgetting it: the mark is still
    // there, which is what makes the silence a LOCK rather than a loss.
    expect(marksIn(contest)).toEqual(["number:159:159-a-namesake,159-a-thread-that-was-first"]);
  });

  it("the mark is lifted by the pair going quiet — and the pair coming back rings again", () => {
    const contest = contour();
    contest.feed({ "159-a-thread-that-was-first": "closed", "159-a-namesake": "open" });
    tick(contest);
    expect(lettersIn(contest)).toBe(1);

    // EVERY HALF CLOSES: the pair stops satisfying the criterion, so its mark leaves the
    // state file. Nothing is said about the closing itself — the letter is not repeated.
    contest.feed({ "159-a-namesake": "closed" });
    const quiet = tick(contest);
    expect(quiet.code).toBe(0);
    expect(lettersIn(contest)).toBe(1);
    expect(marksIn(contest)).toEqual([]);
    // The tick that found the pair and rang about none of it says so out loud — the field
    // acceptance of this watchman is "pairs FOUND and rejected by the criterion".
    expect(quiet.out).toContain("number-collision — 1 number(s)");

    // AND IT COMES BACK: the half reopens, and the watchman rings a second time rather
    // than staying quiet for ever on a mark it no longer holds.
    contest.feed({ "159-a-namesake": "open" });
    const again = tick(contest);
    expect(again.code).toBe(0);
    expect(lettersIn(contest)).toBe(2);
    expect(marksIn(contest)).toEqual(["number:159:159-a-namesake,159-a-thread-that-was-first"]);
  });

  /**
   * THE FIELD DEFECT OF 2026-09-09, and it is a test of the TICK rather than of the lock:
   * both cases above pass on the broken code, because a contour with no transport never
   * reaches the writer that ate the mark.
   *
   * WHAT WAS MEASURED. Pair `180` (`180-notifier-down` and
   * `180-selfheal-leaves-the-workspaces-behind`, both `open`) was announced SEVENTEEN times
   * in four hours into the standing address `181-thread-number-collision`, with identical
   * bodies and intervals from 58 seconds to 59 minutes. The mark stood in
   * `.orchestrator/notify.state` the whole time — it was written every ringing tick and
   * DELETED by every tick that delivered a digest, because `runNotify` rebuilds the whole
   * state file on each write and that one branch of four did not name `numberCollisions`.
   * The irregular intervals are the digests: the watchman rang exactly as often as the box
   * had something to say to a human.
   *
   * So the entry the test has to take is the digest, not the letter — which is why the feed
   * carries a turn standing on curator and the contour carries a transport that answers
   * `sent`. This is the seam the statement of work asked for: the same path the tick goes.
   */
  it("a DELIVERED digest does not take the mark down with it — the pair rings once", () => {
    const contest = contour({ transport: true });
    contest.feed({
      "159-a-thread-that-was-first": "closed",
      "159-a-namesake": "open",
      // The turn that makes the digest go out at all — without it every tick is `quiet`
      // and the branch under test is unreachable.
      "013-somebody-waits": "waiting",
    });

    const first = tick(contest);
    expect(first.code).toBe(0);
    expect(lettersIn(contest)).toBe(1);
    // THE DIGEST WENT OUT — asserted, not assumed: a fixture where it silently did not
    // would pass this test on the broken code exactly as the two above do.
    expect(first.out).toContain("stub: sent");
    expect(marksIn(contest)).toEqual(["number:159:159-a-namesake,159-a-thread-that-was-first"]);

    // THE SECOND TICK — the same live pair, the state file the first one left behind. On
    // the broken code the mark is gone by now and this is the second letter about `180`.
    const second = tick(contest);
    expect(second.code).toBe(0);
    expect(lettersIn(contest)).toBe(1);
    expect(marksIn(contest)).toEqual(["number:159:159-a-namesake,159-a-thread-that-was-first"]);
    // AND THE JOURNAL DOES NOT CALL THE LIVE PAIR CLOSED. This is the second half of the
    // field defect: the only line the circuit writes about this watchman said `every half
    // closed` about a pair both halves of which stood open, and it is what sent the reading
    // of this incident after the wrong reader of `_meta.md`.
    expect(second.out).toContain("number-collision — 1 number(s)");
    expect(second.out).toContain("1 still open (159)");
    expect(second.out).not.toContain("every half closed");
  });
});
