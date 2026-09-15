import { describe, expect, it } from "vitest";

import {
  parseSaidLetters,
  planStandstillLetters,
  planWorkspaceLetters,
  renderSaidLetters,
  renderStandstillLetter,
  renderWorkspaceLetter,
  STANDSTILL_LETTER_TURN,
  standstillLetterKey,
  workspaceLetterKey,
} from "./standstill-letter.js";
import { checkWorkspacePackage } from "./workspace-package.js";

/** The stale-build refusal for a given installed version, as `workspace-package.ts` writes it. */
const staleBuildRefusal = (installed?: string): string => {
  const verdict = checkWorkspacePackage({
    role: "dev-speech",
    path: "/home/x/repo/.worktrees/dev-speech",
    repo: "/home/x/repo",
    facts: {
      ...(installed === undefined ? {} : { installed }),
      reference: "0.2.15",
      pin: "github:lle/aco#agent-protocol-v0.2.15",
    },
  });
  return verdict.ok ? "" : verdict.reason;
};

/**
 * THE REFUSAL IS QUOTED FROM THE DOOR THAT WRITES IT, not paraphrased (thread 212): the
 * letter now forks on the refusal's own mark, so a fixture that dropped the sentence the
 * door actually prints would test the fork against a text no tick ever carries.
 */
const REFUSAL = {
  role: "dev-speech",
  thread: "134-speech-product-seam",
  reason: staleBuildRefusal("0.2.14"),
};

/**
 * A refusal about the STATE of the tree — the one that rang in the field on 2026-09-15 at
 * `13:26:10Z`, with the door's own repair commands inside it.
 */
const DIRTY = {
  role: "dev-core",
  thread: "180-selfheal-leaves-the-workspaces-behind",
  reason:
    "the workspace has uncommitted changes left by the 'exited-without-handoff' run of this pair, and its head is on 'probe/180-p1-firing' — a branch that is not 'dev-core's to write to. KEEP: git -C /w/dev-core checkout -b dev-core/180-x && git -C /w/dev-core commit -am '…' && git -C /w/dev-core push. PARK: git -C /w/dev-core stash push -u",
};

describe("the letter about a workspace the box will not repair (П-1, thread 180)", () => {
  it("writes on the FIRST tick and stays quiet for the 208 that repeat it", () => {
    const first = planWorkspaceLetters({ refusals: [REFUSAL], said: [] });
    expect(first.letters).toEqual([REFUSAL]);
    const again = planWorkspaceLetters({ refusals: [REFUSAL], said: first.said });
    expect(again.letters).toEqual([]);
    expect(again.said).toEqual(first.said);
  });

  it("rings again when the DIVERGENCE changes, because that is a second fact", () => {
    const said = planWorkspaceLetters({ refusals: [REFUSAL], said: [] }).said;
    const moved = { ...REFUSAL, reason: REFUSAL.reason.replace("0.2.14", "0.2.13") };
    expect(planWorkspaceLetters({ refusals: [moved], said }).letters).toEqual([moved]);
  });

  it("forgets a refusal that stopped happening, so a repeat of it is told again", () => {
    const said = planWorkspaceLetters({ refusals: [REFUSAL], said: [] }).said;
    const healthy = planWorkspaceLetters({ refusals: [], said });
    expect(healthy.said).toEqual([]);
    expect(planWorkspaceLetters({ refusals: [REFUSAL], said: healthy.said }).letters).toEqual([
      REFUSAL,
    ]);
  });

  it("says one letter per pair when one tick refuses the same pair twice", () => {
    expect(planWorkspaceLetters({ refusals: [REFUSAL, REFUSAL], said: [] }).letters).toHaveLength(
      1,
    );
  });

  it("names the cure by name and never offers `pnpm install` as one", () => {
    const text = renderWorkspaceLetter(REFUSAL);
    expect(text).toContain("dev-speech×134-speech-product-seam");
    expect(text).toContain(REFUSAL.reason);
    expect(text).toContain("git merge --no-edit origin/main");
    expect(text).toContain("--no-verify");
    // The measured trap: the letter must say that installing does NOT help, and it must not
    // read as an instruction to install.
    expect(text).toContain("НЕ `pnpm install`");
    expect(text).toContain(STANDSTILL_LETTER_TURN);
  });

  /**
   * THE FORK OF THREAD 212: the cure above is the cure of ONE of the nine reasons this door
   * refuses with, and it was printed under all nine. The two cases below are the two sides
   * of it, and the third is the reason that lives in the same module as the first and is
   * still not it — «названный случай — образец, а не класс».
   */
  it("does NOT offer the merge under a refusal about the STATE of the tree", () => {
    const text = renderWorkspaceLetter(DIRTY);
    // What the field letter of 15.09 said and should not have: not one word of the pin cure.
    expect(text).not.toContain("git merge --no-edit origin/main");
    expect(text).not.toContain("--no-verify");
    expect(text).not.toContain("conventional-commits");
    expect(text).not.toContain("НЕ `pnpm install`");
    // And it does not talk over the commands the door has already printed inside the reason.
    expect(text).toContain(DIRTY.reason);
    expect(text).toContain("git -C /w/dev-core stash push -u");
    expect(text).toContain("названо оно ВЫШЕ");
    // The boundary is john's and holds under every reason — it stays.
    expect(text).toContain("Дерево роли на СОБСТВЕННОЙ ветке ящик не трогает");
    expect(text).toContain(STANDSTILL_LETTER_TURN);
  });

  it("does NOT offer the merge for a tree that was never installed — that cure IS the door's", () => {
    const text = renderWorkspaceLetter({ ...REFUSAL, reason: staleBuildRefusal() });
    expect(text).toContain("install --frozen-lockfile");
    expect(text).not.toContain("git merge --no-edit origin/main");
    expect(text).not.toContain("НЕ `pnpm install`");
  });
});

describe("the letter about the box that raised nobody (П-2, thread 180)", () => {
  const standing = [
    { role: "dev-speech", thread: "134-speech-product-seam", text: "its workspace is not usable" },
    { role: "curator", thread: "180-selfheal", text: "its workspace is not usable" },
  ];
  const run = {
    since: "2026-09-15T09:06:49Z",
    ticks: 209,
    candidates: 4,
    reasons: ["its workspace is not usable: the workspace of '…' runs '…' 0.2.14"],
  };

  it("is silent until the run has crossed the threshold", () => {
    expect(planStandstillLetters({ ...run, due: false, standing, said: [] }).letters).toEqual([]);
  });

  it("writes once per standstill RUN, into the feed of every standing pair", () => {
    const first = planStandstillLetters({ ...run, due: true, standing, said: [] });
    expect(first.letters.map((letter) => letter.thread)).toEqual([
      "134-speech-product-seam",
      "180-selfheal",
    ]);
    const next = planStandstillLetters({
      ...run,
      ticks: run.ticks + 1,
      due: true,
      standing,
      said: first.said,
    });
    expect(next.letters).toEqual([]);
  });

  it("writes a SECOND time when the run restarts under a different fault", () => {
    const said = planStandstillLetters({ ...run, due: true, standing, said: [] }).said;
    const second = planStandstillLetters({
      ...run,
      since: "2026-09-15T12:00:00Z",
      due: true,
      standing,
      said,
    });
    expect(second.letters).toHaveLength(2);
  });

  it("drops a standing refusal with no thread rather than inventing a feed for it", () => {
    const plan = planStandstillLetters({
      ...run,
      due: true,
      standing: [{ role: "dev-core", text: "its workspace is not usable" }],
      said: [],
    });
    expect(plan.letters).toEqual([]);
  });

  it("caps how many pairs one standstill writes to", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      role: `role-${index}`,
      thread: `t-${index}`,
      text: "refused",
    }));
    expect(
      planStandstillLetters({ ...run, due: true, standing: many, said: [] }).letters.length,
    ).toBe(5);
  });

  it("puts the box's fact first and quotes what the tick refused with", () => {
    const [letter] = planStandstillLetters({ ...run, due: true, standing, said: [] }).letters;
    expect(letter).toBeDefined();
    if (letter === undefined) return;
    const text = renderStandstillLetter(letter);
    expect(text).toContain("209");
    expect(text).toContain("2026-09-15T09:06:49Z");
    expect(text).toContain("4 ждущих");
    expect(text).toContain(run.reasons[0] ?? "");
  });
});

describe("the ledger of what the feed has already been told", () => {
  it("round-trips, sorted", () => {
    const keys = [
      standstillLetterKey({ role: "b", thread: "t", since: "s" }),
      workspaceLetterKey(REFUSAL),
    ];
    expect(parseSaidLetters(renderSaidLetters(keys))).toEqual([...keys].sort());
  });

  it("reads a missing, empty or corrupt file as an EMPTY ledger, never as a throw", () => {
    expect(parseSaidLetters("")).toEqual([]);
    expect(parseSaidLetters("   ")).toEqual([]);
    expect(parseSaidLetters("{not json")).toEqual([]);
    expect(parseSaidLetters('{"a":1}')).toEqual([]);
    expect(parseSaidLetters('["a", 7, "b"]')).toEqual(["a", "b"]);
  });

  it("collapses whitespace in the key so one fault is one key across two printings", () => {
    expect(workspaceLetterKey({ ...REFUSAL, reason: "  a   b " })).toBe(
      workspaceLetterKey({ ...REFUSAL, reason: "a b" }),
    );
  });
});
