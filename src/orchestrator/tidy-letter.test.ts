import { describe, expect, it } from "vitest";
import {
  describeDeliveredTidyUpLetter,
  describeUndeliveredTidyUpLetter,
  planTidyUpDelivery,
  planTidyUpLetter,
  TIDY_UP_SLUG,
  type TidyUpMemo,
  tidyUpSignature,
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

/**
 * THE LOCK ON THE REPEAT (thread `133-tidy-letter-repeats-every-tick`), R1 and R3 of
 * curator's statement of work — measured first as 1 → 2 letters over one standing
 * incident, then fixed here.
 *
 * Each of the THREE things that make an incident itself is checked ON ITS OWN, because a
 * signature that folded any of them in would let a lock swallow a new happening: a lock
 * that eats a NEW incident is worse than the flood it replaces.
 */
const DIRT = {
  files: [{ path: "CARD.md", what: "modified", added: 1, removed: 1 }],
} as const;

/** The failing outcome the probe on the live contour produced, twice over, unchanged. */
const FAILED = { kind: "failed", cause: "fatal: cannot create branch" } as const;

const memoOf = (signature: string, over: Partial<TidyUpMemo> = {}): TidyUpMemo => ({
  signature,
  at: "2026-09-05T16:00:00Z",
  waitingOn: "curator",
  ...over,
});

describe("the lock on the repeat — one letter per incident, and the tick says so out loud", () => {
  it("the SAME incident twice says nothing new: the second tick is suppressed (R1)", () => {
    const signature = tidyUpSignature({ role: "dev-core", dirt: DIRT, outcome: FAILED });
    // The first tick has nothing remembered — it posts, and that is what makes the memo.
    expect(planTidyUpDelivery({ role: "dev-core", signature }).post).toBe(true);
    const again = planTidyUpDelivery({ role: "dev-core", signature, memo: memoOf(signature) });
    expect(again.post).toBe(false);
  });

  it("a different ROLE is a different incident, even with the same cause and the same dirt (R3)", () => {
    const mine = tidyUpSignature({ role: "dev-core", dirt: DIRT, outcome: FAILED });
    const theirs = tidyUpSignature({ role: "curator", dirt: DIRT, outcome: FAILED });
    expect(theirs).not.toBe(mine);
    expect(
      planTidyUpDelivery({ role: "curator", signature: theirs, memo: memoOf(mine) }).post,
    ).toBe(true);
  });

  it("a different CAUSE is a different incident — the same tree failing a new way is news (R3)", () => {
    const first = tidyUpSignature({ role: "dev-core", dirt: DIRT, outcome: FAILED });
    const second = tidyUpSignature({
      role: "dev-core",
      dirt: DIRT,
      outcome: { kind: "failed", cause: "fatal: the index is broken" },
    });
    expect(second).not.toBe(first);
    expect(
      planTidyUpDelivery({ role: "dev-core", signature: second, memo: memoOf(first) }).post,
    ).toBe(true);
  });

  it("a different COMPOSITION OF THE DIRT is a different incident — the session wrote more (R3)", () => {
    const before = tidyUpSignature({ role: "dev-core", dirt: DIRT, outcome: FAILED });
    const after = tidyUpSignature({
      role: "dev-core",
      dirt: { files: [...DIRT.files, { path: "NOTE.md", what: "untracked" }] },
      outcome: FAILED,
    });
    expect(after).not.toBe(before);
    expect(
      planTidyUpDelivery({ role: "dev-core", signature: after, memo: memoOf(before) }).post,
    ).toBe(true);
  });

  it("a tidy-up that WENT never collides with a previous one: every commit carries its own sha", () => {
    const first = tidyUpSignature({
      role: "dev-core",
      dirt: DIRT,
      outcome: { kind: "done", branch: "wip/dev-core/012-x-a", head: "ab12cd3" },
    });
    const second = tidyUpSignature({
      role: "dev-core",
      dirt: DIRT,
      outcome: { kind: "done", branch: "wip/dev-core/012-x-b", head: "ef45ab6" },
    });
    expect(second).not.toBe(first);
    expect(
      planTidyUpDelivery({ role: "dev-core", signature: second, memo: memoOf(first) }).post,
    ).toBe(true);
  });

  it("the suppressed tick NAMES the incident as told and WHERE to look — a silent lock reads as success (R2)", () => {
    const signature = tidyUpSignature({ role: "dev-core", dirt: DIRT, outcome: FAILED });
    const decided = planTidyUpDelivery({
      role: "dev-core",
      signature,
      memo: memoOf(signature, { branch: "wip/dev-core/012-x-20260905T1600Z" }),
    });
    expect(decided.post).toBe(false);
    const said = (decided as { readonly said: string }).said;
    // (a) that it has already been said, and by whom the turn is held;
    expect(said).toContain("SUPPRESSED");
    expect(said).toContain("dev-core");
    expect(said).toContain("2026-09-05T16:00:00Z");
    expect(said).toContain("curator");
    // (b) WHERE — the standing address, and the branch when the outcome knew one.
    expect(said).toContain(TIDY_UP_SLUG);
    expect(said).toContain("wip/dev-core/012-x-20260905T1600Z");
    // …and it never reads as a delivery that went.
    expect(said).not.toContain("the outcome is posted");
  });

  it("says nothing about a branch when the incident has none — no invented address", () => {
    const signature = tidyUpSignature({ role: "dev-core", dirt: DIRT, outcome: FAILED });
    const decided = planTidyUpDelivery({ role: "dev-core", signature, memo: memoOf(signature) });
    expect((decided as { readonly said: string }).said).not.toContain("the branch is");
  });
});
