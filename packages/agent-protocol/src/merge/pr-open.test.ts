/**
 * THE DESCRIPTION JUDGED BEFORE THE PULL REQUEST EXISTS — the verdict of `pr-open.ts`, and
 * the reader it shares with guard 3. Why it exists at all is in the module's own header
 * (thread `052-pr-template`, john 2026-09-02: `role:` becomes as obligatory as `thread:`).
 *
 * What is asserted here is the REFUSAL, field by field: a door that refuses without saying
 * which field and of what shape is the defect this repair is made of, not the repair.
 */
import { describe, expect, it } from "vitest";

import { roleOfDescription } from "./gate.js";
import {
  type CheckoutAnswer,
  checkoutAnswerOf,
  judgeBodyLocation,
  judgePrDescription,
} from "./pr-open.js";

const KNOWN = new Set(["dev-core", "curator", "reviewer-pr"]);
const judge = (body: string) => judgePrDescription({ body, isKnownRole: (id) => KNOWN.has(id) });

/** Every refusal as one string — the assertions ask what the caller is told, not its shape. */
const said = (body: string): string => {
  const verdict = judge(body);
  expect(verdict.ok).toBe(false);
  return verdict.ok ? "" : verdict.refusals.join("\n");
};

describe("roleOfDescription — the fourth reader of the two lines", () => {
  it("takes the id of a role and nothing else", () => {
    expect(roleOfDescription("thread: 052-pr-template\nrole: dev-core\n")).toBe("dev-core");
    expect(roleOfDescription("role: reviewer-pr")).toBe("reviewer-pr");
  });

  it("does not take the placeholder of the template, with the arrow or without it", () => {
    expect(roleOfDescription("role: <id> ← заполнить")).toBeUndefined();
    expect(roleOfDescription("role: <id>")).toBeUndefined();
  });

  it("does not take a capitalised or spaced value — the greps read lowercase ids", () => {
    expect(roleOfDescription("role: Dev-Core")).toBeUndefined();
    expect(roleOfDescription("role: dev core")).toBeUndefined();
    expect(roleOfDescription("role: -dev")).toBeUndefined();
  });

  it("does not take a role named in prose — the line is a line, not a mention", () => {
    expect(roleOfDescription("this is the role: dev-core of the thread")).toBeUndefined();
  });
});

describe("judgePrDescription — the door before the pull request", () => {
  const good =
    "thread: 052-pr-template\nrole: dev-core\n\nWhat this PR is and what it stands on.\n";

  it("passes a description with both fields first, and says what it read", () => {
    const verdict = judge(good);
    expect(verdict).toEqual({ ok: true, thread: "052-pr-template", role: "dev-core" });
  });

  it("refuses the template's own placeholder — by name, both fields at once", () => {
    const refusals = said("thread: NNN-slug ← заполнить\nrole: <id> ← заполнить\n\nprose\n");
    expect(refusals).toContain("thread: <slug>");
    expect(refusals).toContain("role: <id>");
    expect(refusals).toContain("line 1");
    expect(refusals).toContain("line 2");
  });

  it("names the MISSING field when there is no such line at all", () => {
    expect(said("role: dev-core\n\nprose")).toContain("names no thread");
    expect(said("thread: 052-pr-template\n\nprose")).toContain("names no role");
  });

  it("refuses the fields in the footer — the whole of the defect the thread came from", () => {
    const refusals = said("Some prose first.\n\nthread: 052-pr-template\nrole: dev-core\n");
    expect(refusals).toContain("line 3, not on line 1");
    expect(refusals).toContain("line 4, not on line 2");
  });

  it("refuses the two fields in the wrong ORDER — line 1 is the thread", () => {
    expect(said("role: dev-core\nthread: 052-pr-template\n\nprose")).toContain("not on line 1");
  });

  it("refuses a role no config declares — a turn nobody could be handed", () => {
    const refusals = said("thread: 052-pr-template\nrole: dev-cores\n\nprose");
    expect(refusals).toContain("'dev-cores' is not listed in the protocol config");
  });

  it("refuses an empty body without saying anything but the two fields", () => {
    const refusals = said("");
    expect(refusals).toContain("names no thread");
    expect(refusals).toContain("names no role");
  });
});

/**
 * THE SECOND DOOR — where the body FILE lies (thread `157-pr-open-body-inside-checkout`).
 *
 * The reader of git is injected, so what is asserted here is the JUDGEMENT and every edge
 * of it named in the module header; that git really answers this way for a nested checkout
 * and through a symlink is a fact of git, and it is measured in `pr-open.process.test.ts`
 * against a real repository rather than restated by a stub here.
 */
describe("judgeBodyLocation — the body file that must not lie in a tree", () => {
  /** The three answers of git, as the door receives them — see `CheckoutAnswer`. */
  const inside = (at: string): CheckoutAnswer => ({ kind: "checkout", at });
  const nowhere: CheckoutAnswer = { kind: "none" };

  const judgeAt = (path: string, checkout: CheckoutAnswer, ignored = false) =>
    judgeBodyLocation({ path, checkoutOf: () => checkout, isIgnored: () => ignored });

  it("refuses a path inside a checkout, NAMING both the file and the checkout", () => {
    const verdict = judgeAt("/home/x/repo/.pr278-body.md", inside("/home/x/repo"));
    expect(verdict.ok).toBe(false);
    const refusal = verdict.ok ? "" : verdict.refusal;
    expect(refusal).toContain("'/home/x/repo/.pr278-body.md'");
    expect(refusal).toContain("'/home/x/repo'");
  });

  it("says where to put it instead — a door without an exit is a riddle", () => {
    const verdict = judgeAt("/home/x/repo/body.md", inside("/home/x/repo"));
    const refusal = verdict.ok ? "" : verdict.refusal;
    // `-p /tmp` and not a bare `mktemp -d`: a session's TMPDIR can be inside the checkout.
    expect(refusal).toContain("mktemp -d -p /tmp");
    expect(refusal).toContain("OUTSIDE any checkout");
    // And that nothing was created — the caller's next step depends on it.
    expect(refusal).toContain("Nothing was created");
  });

  it("passes a path in no repository at all — the normal path of every role", () => {
    expect(judgeAt("/tmp/agent-protocol-body-xyz/body.md", nowhere).ok).toBe(true);
  });

  it("passes when git answered with nothing at all rather than failing", () => {
    // The empty string is not a checkout: `checkoutAnswerOf` trims what git printed and
    // calls that `none` — a door reading `''` as a repository would refuse every path.
    expect(
      judgeAt(
        "/tmp/body.md",
        checkoutAnswerOf(() => ""),
      ).ok,
    ).toBe(true);
  });

  it("refuses by the INNERMOST checkout when they are nested", () => {
    const verdict = judgeAt(
      "/home/x/repo/vendor/inner/body.md",
      inside("/home/x/repo/vendor/inner"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.refusal).toContain("'/home/x/repo/vendor/inner'");
  });

  it("asks about the DIRECTORY of the file, not the file — the file need not exist", () => {
    const asked: string[] = [];
    judgeBodyLocation({
      path: "/home/x/repo/sub/body.md",
      checkoutOf: (dir) => {
        asked.push(dir);
        return nowhere;
      },
      isIgnored: () => false,
    });
    expect(asked).toEqual(["/home/x/repo/sub"]);
  });

  it("resolves a relative path before asking — the answer must not depend on the form", () => {
    const asked: string[] = [];
    judgeBodyLocation({
      path: "body.md",
      checkoutOf: (dir) => {
        asked.push(dir);
        return nowhere;
      },
      isIgnored: () => false,
    });
    expect(asked).toEqual([process.cwd()]);
  });

  it("passes a path the checkout IGNORES — the self-restart writes over it without a word", () => {
    // The session's own temp lives under `.orchestrator/`, ignored as machine state of the
    // contour, and `git pull --ff-only` does not refuse over an ignored file. Measured on a
    // raised session, 2026-09-07: `mktemp -d` lands there and git names the served root.
    expect(
      judgeAt("/home/x/repo/.orchestrator/sessions/r.tmp/body.md", inside("/home/x/repo"), true).ok,
    ).toBe(true);
  });

  it("asks about the ignore ONLY when the file is inside a checkout", () => {
    let asked = 0;
    judgeBodyLocation({
      path: "/tmp/outside/body.md",
      checkoutOf: () => nowhere,
      isIgnored: () => {
        asked += 1;
        return false;
      },
    });
    expect(asked).toBe(0);
  });

  it("asks the ignore about the FILE and from its own directory", () => {
    const asked: Array<readonly [string, string]> = [];
    judgeBodyLocation({
      path: "/home/x/repo/sub/body.md",
      checkoutOf: () => inside("/home/x/repo"),
      isIgnored: (dir, path) => {
        asked.push([dir, path]);
        return true;
      },
    });
    expect(asked).toEqual([["/home/x/repo/sub", "/home/x/repo/sub/body.md"]]);
  });

  /**
   * THE EDGE THE FIRST CUT OF THIS DOOR PASSED IN SILENCE (verdict of `reviewer-pr` on
   * #328): «git did not answer» is not «there is no checkout», and reading it as the
   * latter is the one failure direction this door exists to refuse in.
   */
  it("refuses when git could not say, and quotes git's own words", () => {
    const verdict = judgeBodyLocation({
      path: "/home/x/body.md",
      checkoutOf: () => ({ kind: "unknown", why: "git rev-parse spawnSync git ENOENT" }),
      isIgnored: () => false,
    });
    expect(verdict.ok).toBe(false);
    const refusal = verdict.ok ? "" : verdict.refusal;
    expect(refusal).toContain("git could not say");
    expect(refusal).toContain("spawnSync git ENOENT");
    // Actionable in both directions: repair git, or put the file where it belongs.
    expect(refusal).toContain("mktemp -d -p /tmp");
    expect(refusal).toContain("Nothing was created");
  });

  it("does not ask the ignore when git could not say — there is no checkout to ask", () => {
    let asked = 0;
    judgeBodyLocation({
      path: "/home/x/body.md",
      checkoutOf: () => ({ kind: "unknown", why: "boom" }),
      isIgnored: () => {
        asked += 1;
        return true;
      },
    });
    expect(asked).toBe(0);
  });
});

/**
 * THE CLASSIFIER — kept pure so the three answers are testable without a broken git.
 * `LC_ALL=C` at the call site is what makes the middle case recognisable by its sentence.
 */
describe("checkoutAnswerOf — the two ways git fails, told apart", () => {
  it("reads what --show-toplevel printed as the checkout, trimmed", () => {
    expect(checkoutAnswerOf(() => "/home/x/repo\n")).toEqual({
      kind: "checkout",
      at: "/home/x/repo",
    });
  });

  it("reads git's own 'not a git repository' as an ANSWER: there is no checkout", () => {
    const answer = checkoutAnswerOf(() => {
      throw new Error(
        "git -C /tmp/x rev-parse --show-toplevel exited with code 128: fatal: not a git repository (or any of the parent directories): .git",
      );
    });
    expect(answer).toEqual({ kind: "none" });
  });

  it("reads any other failure as UNKNOWN, carrying the message into the refusal", () => {
    expect(
      checkoutAnswerOf(() => {
        throw new Error("git -C /tmp/x rev-parse --show-toplevel spawnSync git ENOENT");
      }),
    ).toEqual({ kind: "unknown", why: expect.stringContaining("ENOENT") });
  });

  it("reads an empty print as no checkout, not as a repository called ''", () => {
    expect(checkoutAnswerOf(() => "  \n")).toEqual({ kind: "none" });
  });
});
