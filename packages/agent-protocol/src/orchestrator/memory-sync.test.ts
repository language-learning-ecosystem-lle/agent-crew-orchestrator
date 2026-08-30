import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { roleIdentity } from "../roles/identity.js";
import type { GitRun } from "../thread/deliver.js";
import {
  conflictLine,
  memoryBranchDirectory,
  memoryBranchPrefix,
  planRestore,
  planSave,
  readSnapshot,
  restoreLines,
  restoreRoleMemory,
  roleMemorySnapshotFile,
  saveRoleMemory,
} from "./memory-sync.js";

const snapshot = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("planning the restore", () => {
  it("writes what the branch has and REMOVES what it does not — the death of a note is the mirror", () => {
    const plan = planRestore({
      branch: snapshot({ "MEMORY.md": "- one\n", "one.md": "one" }),
      live: snapshot({ "MEMORY.md": "- one\n- two\n", "one.md": "one", "two.md": "two" }),
    });
    expect(plan.writes).toEqual([{ path: "MEMORY.md", content: "- one\n" }]);
    expect(plan.removals).toEqual(["two.md"]);
  });

  it("says nothing to do when the box already matches the branch", () => {
    const same = { "MEMORY.md": "- one\n" };
    const plan = planRestore({ branch: snapshot(same), live: snapshot(same) });
    expect(plan).toEqual({ writes: [], removals: [], conflicts: [] });
  });
});

describe("planning the save — this session's own changes and nothing else", () => {
  it("carries what the session wrote and what it deleted", () => {
    const plan = planSave({
      restored: snapshot({ "old.md": "old", "gone.md": "gone" }),
      live: snapshot({ "old.md": "old", "new.md": "new" }),
      branch: snapshot({ "old.md": "old", "gone.md": "gone" }),
    });
    expect(plan.writes).toEqual([{ path: "new.md", content: "new" }]);
    expect(plan.removals).toEqual(["gone.md"]);
    expect(plan.conflicts).toEqual([]);
  });

  it("DOES NOT RESURRECT a note curator deleted in the branch while the session ran", () => {
    // The session never touched `dead.md`: it is in the restore and unchanged on the box.
    const plan = planSave({
      restored: snapshot({ "dead.md": "a note that contradicts the card" }),
      live: snapshot({ "dead.md": "a note that contradicts the card" }),
      branch: snapshot({}),
    });
    expect(plan).toEqual({ writes: [], removals: [], conflicts: [] });
  });

  it("refuses to write over a note somebody moved first — first-write-wins, per file", () => {
    const plan = planSave({
      restored: snapshot({ "note.md": "as restored" }),
      live: snapshot({ "note.md": "mine" }),
      branch: snapshot({ "note.md": "theirs, pushed while we ran" }),
    });
    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual(["note.md"]);
  });

  it("is not a conflict when two sessions wrote the same byte", () => {
    const plan = planSave({
      restored: snapshot({ "note.md": "as restored" }),
      live: snapshot({ "note.md": "the same edit" }),
      branch: snapshot({ "note.md": "the same edit" }),
    });
    expect(plan).toEqual({ writes: [], removals: [], conflicts: [] });
  });
});

describe("the loud lines", () => {
  it("names the loser of a conflict and where its bytes still are", () => {
    expect(
      conflictLine({ role: "dev-core", paths: ["note.md"], directory: "/state/memory/dev-core" }),
    ).toBe(
      "memory: 1 note(s) of 'dev-core' were NOT saved — the branch moved under them while the session ran, and the write that landed first stands (note.md). This box's version is still in /state/memory/dev-core and the next raise will replace it with the branch's — copy it out now if it matters.",
    );
  });
});

describe("where the notes live in the branch", () => {
  it("is <mail.dir>/memory/<role> — the mail directory from the config, not this package's literal", () => {
    expect(memoryBranchPrefix({ mailDir: "letters", role: "dev-core" })).toBe(
      "letters/memory/dev-core",
    );
    expect(memoryBranchDirectory({ mailRoot: "/box/co/agent-comms", role: "curator" })).toBe(
      "/box/co/agent-comms/memory/curator",
    );
  });
});

const git = (at: string, ...args: string[]): string =>
  execFileSync("git", ["-C", at, ...args], { encoding: "utf8" });

const gitIn =
  (at: string): GitRun =>
  (args, env) =>
    execFileSync("git", ["-C", at, ...args], {
      encoding: "utf8",
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });

type Contour = {
  readonly origin: string;
  readonly mail: string;
  readonly mailRoot: string;
  readonly state: string;
  readonly live: string;
  readonly manifest: string;
};

/** An origin on `comms` plus a mail checkout of it, plus the box's own state directory. */
const contour = (): Contour => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-memory-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "comms", origin]);

  const seed = join(base, "seed");
  execFileSync("git", ["clone", "-q", origin, seed]);
  mkdirSync(join(seed, "agent-comms"), { recursive: true });
  writeFileSync(join(seed, "agent-comms", "INDEX.md"), "the registry\n");
  git(seed, "add", ".");
  git(seed, "-c", "user.email=t@agents.invalid", "-c", "user.name=t", "commit", "-qm", "seed");
  git(seed, "push", "-q", "origin", "comms");

  const mail = join(base, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  const state = join(base, "state");
  const live = join(state, "memory", "dev-core");
  mkdirSync(live, { recursive: true });
  return {
    origin,
    mail,
    mailRoot: join(mail, "agent-comms"),
    state,
    live,
    manifest: roleMemorySnapshotFile({ memory: join(state, "memory"), role: "dev-core" }),
  };
};

const sync = (c: Contour) => ({
  git: gitIn(c.mail),
  branch: "comms",
  mailDir: "agent-comms",
  role: "dev-core",
  directory: c.live,
  snapshotFile: c.manifest,
});

/** Somebody else writes into the feed — the way a real concurrent change arrives. */
const inTheBranch = (c: Contour, edit: (at: string) => void): void => {
  const other = mkdtempSync(join(tmpdir(), "agent-protocol-other-"));
  execFileSync("git", ["clone", "-q", "-b", "comms", c.origin, other]);
  edit(other);
  git(other, "add", "-A", "agent-comms");
  git(
    other,
    "-c",
    "user.email=c@agents.invalid",
    "-c",
    "user.name=curator",
    "commit",
    "-qm",
    "theirs",
  );
  git(other, "push", "-q", "origin", "comms");
};

describe("the seam: a note goes to the branch and comes back, and the mail checkout stays clean", () => {
  it("saves what the session wrote as a commit on the mail branch", () => {
    const c = contour();
    restoreRoleMemory(sync(c));
    writeFileSync(join(c.live, "MEMORY.md"), "- [a fact](fact.md)\n");
    writeFileSync(join(c.live, "fact.md"), "the fact\n");

    const said = saveRoleMemory({
      ...sync(c),
      mailRoot: c.mailRoot,
      identity: roleIdentity("dev-core"),
    });

    expect(said.join("\n")).toContain("were saved to the mail branch");
    // In the BRANCH, not merely on the disk of this box: asked of the remote.
    const listed = git(
      c.mail,
      "ls-tree",
      "-r",
      "--name-only",
      "origin/comms",
      "--",
      "agent-comms/memory",
    );
    expect(listed.trim().split("\n").sort()).toEqual([
      "agent-comms/memory/dev-core/MEMORY.md",
      "agent-comms/memory/dev-core/fact.md",
    ]);
    // THE OTHER HALF OF THE SEAM (curator's §4): a dirty mail checkout shuts the mail for
    // every role on the box, so the state it is left in is part of the contract.
    expect(git(c.mail, "status", "--porcelain").trim()).toBe("");
    // And the author is the ROLE, not whoever configured the shared checkout last (027).
    expect(git(c.mail, "log", "-1", "--format=%an", "origin/comms").trim()).toBe("dev-core");
  });

  it("restores into a box that has never seen the role, and the next session reads it", () => {
    const c = contour();
    restoreRoleMemory(sync(c));
    writeFileSync(join(c.live, "MEMORY.md"), "- [a fact](fact.md)\n");
    saveRoleMemory({ ...sync(c), mailRoot: c.mailRoot, identity: roleIdentity("dev-core") });

    rmSync(c.live, { recursive: true, force: true });
    const back = restoreRoleMemory(sync(c));

    expect(readFileSync(join(c.live, "MEMORY.md"), "utf8")).toBe("- [a fact](fact.md)\n");
    expect(back.lines.join("\n")).toContain("restored from the mail branch");
  });

  it("KILLS a note deleted in the branch — and the box's copy does not bring it back", () => {
    const c = contour();
    restoreRoleMemory(sync(c));
    writeFileSync(join(c.live, "dead.md"), "a note the card now contradicts\n");
    saveRoleMemory({ ...sync(c), mailRoot: c.mailRoot, identity: roleIdentity("dev-core") });

    // curator deletes it in the branch, by hand, without ceremony (john's word).
    inTheBranch(c, (at) => rmSync(join(at, "agent-comms", "memory", "dev-core", "dead.md")));

    // A next session of the same role: restore, touch nothing of that note, release.
    restoreRoleMemory(sync(c));
    expect(existsSync(join(c.live, "dead.md"))).toBe(false);
    writeFileSync(join(c.live, "other.md"), "unrelated\n");
    saveRoleMemory({ ...sync(c), mailRoot: c.mailRoot, identity: roleIdentity("dev-core") });

    const listed = git(
      c.mail,
      "ls-tree",
      "-r",
      "--name-only",
      "origin/comms",
      "--",
      "agent-comms/memory",
    );
    expect(listed).not.toContain("dead.md");
    expect(listed).toContain("other.md");
  });

  it("carries a deletion the SESSION made into the branch", () => {
    const c = contour();
    restoreRoleMemory(sync(c));
    writeFileSync(join(c.live, "stale.md"), "moved into the role card\n");
    saveRoleMemory({ ...sync(c), mailRoot: c.mailRoot, identity: roleIdentity("dev-core") });

    restoreRoleMemory(sync(c));
    rmSync(join(c.live, "stale.md"));
    saveRoleMemory({ ...sync(c), mailRoot: c.mailRoot, identity: roleIdentity("dev-core") });

    expect(
      git(c.mail, "ls-tree", "-r", "--name-only", "origin/comms", "--", "agent-comms/memory"),
    ).not.toContain("stale.md");
    expect(git(c.mail, "status", "--porcelain").trim()).toBe("");
  });

  it("does not write over a note the branch moved first, and says so loudly", () => {
    const c = contour();
    restoreRoleMemory(sync(c));
    writeFileSync(join(c.live, "note.md"), "as restored\n");
    saveRoleMemory({ ...sync(c), mailRoot: c.mailRoot, identity: roleIdentity("dev-core") });

    restoreRoleMemory(sync(c));
    inTheBranch(c, (at) =>
      writeFileSync(join(at, "agent-comms", "memory", "dev-core", "note.md"), "theirs\n"),
    );
    writeFileSync(join(c.live, "note.md"), "mine\n");

    const said = saveRoleMemory({
      ...sync(c),
      mailRoot: c.mailRoot,
      identity: roleIdentity("dev-core"),
    });

    expect(said.join("\n")).toContain("were NOT saved");
    expect(git(c.mail, "show", "origin/comms:agent-comms/memory/dev-core/note.md")).toBe(
      "theirs\n",
    );
    expect(git(c.mail, "status", "--porcelain").trim()).toBe("");
  });

  it("a branch it cannot read is a loud line and a raise that happens anyway", () => {
    const c = contour();
    writeFileSync(join(c.live, "left.md"), "from the previous round\n");
    const said = restoreRoleMemory({ ...sync(c), git: gitIn(c.mail), branch: "no-such-branch" });
    expect(said.lines.join("\n")).toContain("could NOT be restored");
    expect(readSnapshot(c.live).get("left.md")).toBe("from the previous round\n");
  });
});

describe("what a restore says — the ceiling does not depend on git", () => {
  it("a restore that THREW still measures the ceiling: the failure is loud and the alarm follows it", () => {
    const said = restoreLines({
      role: "dev-core",
      restore: () => {
        throw new Error("'/box/mail' is not a git repository");
      },
      alarm: () => "memory: the index of 'dev-core' is over the ceiling",
    });
    expect(said).toHaveLength(2);
    expect(said[0]).toContain("could NOT be restored");
    expect(said[0]).toContain("not a git repository");
    expect(said[1]).toContain("over the ceiling");
  });

  it("the ceiling rides on a restore that worked too, after its own lines", () => {
    const said = restoreLines({
      role: "dev-core",
      restore: () => ({ lines: ["memory: 3 note(s) restored"] }),
      alarm: () => "memory: the index of 'dev-core' is over the ceiling",
    });
    expect(said).toEqual([
      "memory: 3 note(s) restored",
      "memory: the index of 'dev-core' is over the ceiling",
    ]);
  });

  it("a ceiling that holds adds nothing — on either path", () => {
    expect(
      restoreLines({ role: "dev-core", restore: () => ({ lines: [] }), alarm: () => undefined }),
    ).toEqual([]);
    const failed = restoreLines({
      role: "dev-core",
      restore: () => {
        throw new Error("boom");
      },
      alarm: () => undefined,
    });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("could NOT be restored");
  });
});
