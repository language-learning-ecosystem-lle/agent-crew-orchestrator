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
import { judgeBodyLocation, judgePrDescription } from "./pr-open.js";

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
  const judgeAt = (path: string, checkout: string | undefined, ignored = false) =>
    judgeBodyLocation({ path, checkoutOf: () => checkout, isIgnored: () => ignored });

  it("refuses a path inside a checkout, NAMING both the file and the checkout", () => {
    const verdict = judgeAt("/home/x/repo/.pr278-body.md", "/home/x/repo");
    expect(verdict.ok).toBe(false);
    const refusal = verdict.ok ? "" : verdict.refusal;
    expect(refusal).toContain("'/home/x/repo/.pr278-body.md'");
    expect(refusal).toContain("'/home/x/repo'");
  });

  it("says where to put it instead — a door without an exit is a riddle", () => {
    const verdict = judgeAt("/home/x/repo/body.md", "/home/x/repo");
    const refusal = verdict.ok ? "" : verdict.refusal;
    // `-p /tmp` and not a bare `mktemp -d`: a session's TMPDIR can be inside the checkout.
    expect(refusal).toContain("mktemp -d -p /tmp");
    expect(refusal).toContain("OUTSIDE any checkout");
    // And that nothing was created — the caller's next step depends on it.
    expect(refusal).toContain("Nothing was created");
  });

  it("passes a path in no repository at all — the normal path of every role", () => {
    expect(judgeAt("/tmp/agent-protocol-body-xyz/body.md", undefined).ok).toBe(true);
  });

  it("passes when git answered with nothing at all rather than failing", () => {
    // The empty string is not a checkout: `checkoutOf` trims what git printed, and a door
    // that read `''` as a repository would refuse every path on a machine without git.
    expect(judgeAt("/tmp/body.md", "").ok).toBe(true);
  });

  it("refuses by the INNERMOST checkout when they are nested", () => {
    const verdict = judgeAt("/home/x/repo/vendor/inner/body.md", "/home/x/repo/vendor/inner");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.refusal).toContain("'/home/x/repo/vendor/inner'");
  });

  it("asks about the DIRECTORY of the file, not the file — the file need not exist", () => {
    const asked: string[] = [];
    judgeBodyLocation({
      path: "/home/x/repo/sub/body.md",
      checkoutOf: (dir) => {
        asked.push(dir);
        return undefined;
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
        return undefined;
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
      judgeAt("/home/x/repo/.orchestrator/sessions/r.tmp/body.md", "/home/x/repo", true).ok,
    ).toBe(true);
  });

  it("asks about the ignore ONLY when the file is inside a checkout", () => {
    let asked = 0;
    judgeBodyLocation({
      path: "/tmp/outside/body.md",
      checkoutOf: () => undefined,
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
      checkoutOf: () => "/home/x/repo",
      isIgnored: (dir, path) => {
        asked.push([dir, path]);
        return true;
      },
    });
    expect(asked).toEqual([["/home/x/repo/sub", "/home/x/repo/sub/body.md"]]);
  });
});
