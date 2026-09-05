import { describe, expect, it } from "vitest";
import {
  describeDeliveredTidyUpLetter,
  describeUndeliveredTidyUpLetter,
  planTidyUpLetter,
  TIDY_UP_SLUG,
} from "./tidy-letter.js";

const base = {
  role: "dev-core",
  path: "/srv/aco/.worktrees/dev-core",
  thread: "099-dirty-tree-locks-the-role",
  root: "/srv/aco/.worktrees/comms/agent-comms",
} as const;

/** The flag's value, read out of the argv the plan hands to the child. */
const flagValue = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

describe("planTidyUpLetter — the address the turn goes to", () => {
  it("hands the turn to the ROLE when the tidy-up went: its tree is clean and it can take it", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/dev-core/099-x-20260905T1231Z", head: "ab12cd3" },
    });
    expect(letter.waitingOn).toBe("dev-core");
    expect(flagValue(letter.argv, "--waiting-on")).toBe("dev-core");
  });

  it("hands the turn to CURATOR when the tidy-up did NOT go: the role's turn is untakeable forever", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "failed", cause: "git commit — nothing to commit" },
    });
    expect(letter.waitingOn).toBe("curator");
    expect(flagValue(letter.argv, "--waiting-on")).toBe("curator");
  });

  it("hands the turn to CURATOR when the work is committed but the tree is stranded — the launch is still refused", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: {
        kind: "stranded",
        branch: "wip/dev-core/099-x-20260905T1231Z",
        head: "ab12cd3",
        cause: "git checkout --detach — index.lock exists",
      },
    });
    expect(letter.waitingOn).toBe("curator");
  });
});

describe("planTidyUpLetter — what the body is REQUIRED to say", () => {
  it("names the branch and the sha when the tidy-up went — the address of the work is the point", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/dev-core/099-x-20260905T1231Z", head: "ab12cd3" },
    });
    expect(letter.body).toContain("wip/dev-core/099-x-20260905T1231Z");
    expect(letter.body).toContain("ab12cd3");
  });

  it("names branch and sha in the STRANDED case too — the work is saved even though the launch is not", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: {
        kind: "stranded",
        branch: "wip/dev-core/099-x-20260905T1231Z",
        head: "ab12cd3",
        cause: "git checkout --detach — index.lock exists",
      },
    });
    expect(letter.body).toContain("wip/dev-core/099-x-20260905T1231Z");
    expect(letter.body).toContain("ab12cd3");
    expect(letter.body).toContain("index.lock exists");
  });

  it("names the CAUSE when the tidy-up did not go, and claims no address it does not have", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "failed", cause: "git add -A — permission denied" },
    });
    expect(letter.body).toContain("permission denied");
    expect(letter.body).not.toContain("коммит `");
  });

  it("says the push did NOT go, and that the work is on the box only — silence there would read as pushed", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: {
        kind: "done",
        branch: "wip/dev-core/099-x-20260905T1231Z",
        head: "ab12cd3",
        push: "git push — could not read Username",
      },
    });
    expect(letter.body).toContain("НЕ прошёл");
    expect(letter.body).toContain("could not read Username");
    expect(letter.body).toContain("ТОЛЬКО на этой машине");
  });

  it("says the push went when it went", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/dev-core/099-x", head: "ab12cd3" },
    });
    expect(letter.body).toContain("push:** прошёл");
  });

  it("carries the composition of the dirt — what was lying there is decidable from the letter alone", () => {
    const letter = planTidyUpLetter({
      ...base,
      dirt: { files: [{ path: "docs/x.md", what: "modified", added: 3, removed: 1 }] },
      outcome: { kind: "done", branch: "wip/dev-core/099-x", head: "ab12cd3" },
    });
    expect(letter.body).toContain("docs/x.md");
  });

  it("says the dirt was not read rather than printing nothing, when it was not", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/dev-core/099-x", head: "ab12cd3" },
    });
    expect(letter.body).toContain("не прочитано");
  });

  it("names the role and the tree path in every outcome", () => {
    for (const outcome of [
      { kind: "done", branch: "wip/x", head: "ab12cd3" },
      { kind: "failed", cause: "boom" },
      { kind: "stranded", branch: "wip/x", head: "ab12cd3", cause: "boom" },
    ] as const) {
      const letter = planTidyUpLetter({ ...base, outcome });
      expect(letter.body).toContain("dev-core");
      expect(letter.body).toContain("/srv/aco/.worktrees/dev-core");
    }
  });
});

describe("planTidyUpLetter — the form of the delivery", () => {
  it("is the form already in the contour: from the system, expects none, WITH a turn, into a standing address", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/x", head: "ab12cd3" },
    });
    expect(letter.argv[0]).toBe("new-message");
    expect(flagValue(letter.argv, "--from")).toBe("github");
    expect(flagValue(letter.argv, "--expects")).toBe("none");
    expect(flagValue(letter.argv, "--ensure-thread")).toBe(TIDY_UP_SLUG);
    expect(letter.argv).toContain("--write");
    // `--thread` and `--ensure-thread` are exclusive at the door: naming both is a refusal.
    expect(letter.argv).not.toContain("--thread");
  });

  it("names the participants a receiver would be OPENED with — sender, subject role, curator", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/x", head: "ab12cd3" },
    });
    expect(flagValue(letter.argv, "--participants")?.split(",").sort()).toEqual([
      "curator",
      "dev-core",
      "github",
    ]);
    expect(flagValue(letter.argv, "--title")).toBeTypeOf("string");
  });

  it("does not name curator twice when the role IS curator", () => {
    const letter = planTidyUpLetter({
      ...base,
      role: "curator",
      outcome: { kind: "done", branch: "wip/x", head: "ab12cd3" },
    });
    expect(flagValue(letter.argv, "--participants")).toBe("github,curator");
  });

  it("names the mail root, and forwards --repo/--ref only when the caller has them", () => {
    const without = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/x", head: "ab12cd3" },
    });
    expect(flagValue(without.argv, "--root")).toBe(base.root);
    expect(without.argv).not.toContain("--ref");
    expect(without.argv).not.toContain("--repo");
    const with_ = planTidyUpLetter({
      ...base,
      repo: "/srv/aco",
      ref: "origin/main",
      outcome: { kind: "done", branch: "wip/x", head: "ab12cd3" },
    });
    expect(flagValue(with_.argv, "--repo")).toBe("/srv/aco");
    expect(flagValue(with_.argv, "--ref")).toBe("origin/main");
  });

  it("names what wrote it — the package itself, not a session", () => {
    const letter = planTidyUpLetter({
      ...base,
      outcome: { kind: "done", branch: "wip/x", head: "ab12cd3" },
    });
    expect(flagValue(letter.argv, "--worker")).toBe("agent-protocol");
  });
});

describe("the journal line of a delivery", () => {
  it("says the letter did NOT go, what refused it, and WHERE THE WORK IS — the line is the only trace left", () => {
    const said = describeUndeliveredTidyUpLetter({
      role: "dev-core",
      waitingOn: "dev-core",
      cause: "'new-message' exited 2 — role 'github' is not listed in the config",
      at: { branch: "wip/dev-core/099-x", head: "ab12cd3" },
    });
    expect(said).toContain("NOT DELIVERED");
    expect(said).toContain("not listed in the config");
    expect(said).toContain("wip/dev-core/099-x");
    expect(said).toContain("ab12cd3");
    // AND IT DOES NOT SAY THE TIDY-UP FAILED — the commit stands, only the letter is lost.
    expect(said).toContain("STANDS");
  });

  it("leaves the address out when there is none — a failed tidy-up has no branch to point at", () => {
    const said = describeUndeliveredTidyUpLetter({
      role: "dev-core",
      waitingOn: "curator",
      cause: "it could not be run — ENOENT",
    });
    expect(said).toContain("NOT DELIVERED");
    expect(said).not.toContain("committed as");
  });

  it("names the turn the delivered letter carries, so the log says who was raised", () => {
    expect(describeDeliveredTidyUpLetter({ waitingOn: "curator" })).toContain("curator");
    expect(describeDeliveredTidyUpLetter({ waitingOn: "curator" })).toContain(TIDY_UP_SLUG);
  });
});
