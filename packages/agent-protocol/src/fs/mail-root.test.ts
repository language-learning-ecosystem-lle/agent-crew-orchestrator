/**
 * ONE BASE, WHATEVER THE CALLER TYPED (thread 015) — the resolution itself, without a
 * process. The stake is in `mail-root.ts`: the two phases of a delivery measured a
 * relative `--root` about two different directories, and the second one found out after
 * the file had been written.
 */
import { describe, expect, it } from "vitest";
import { resolveMailRoot } from "./mail-root.js";

describe("resolveMailRoot", () => {
  it("measures a relative value about the caller's directory — the base its shell meant", () => {
    expect(resolveMailRoot(".worktrees/comms/agent-comms", "/home/box/repo")).toBe(
      "/home/box/repo/.worktrees/comms/agent-comms",
    );
  });

  // The live shape of the defect: the command is typed INSIDE the mail checkout, so the
  // value is relative to a directory that is not the repository root — and `git -C
  // <checkout> add -- <that>` walks out of the repository (`fatal: … is outside
  // repository`) after the message file is already on disk.
  it("resolves a value that walks out of its directory — both phases then see one path", () => {
    expect(resolveMailRoot("../agent-comms", "/home/box/repo/agent-comms")).toBe(
      "/home/box/repo/agent-comms",
    );
  });

  it("leaves an absolute value where it points, normalized", () => {
    expect(resolveMailRoot("/mail/agent-comms")).toBe("/mail/agent-comms");
    expect(resolveMailRoot("/mail/./x/../agent-comms")).toBe("/mail/agent-comms");
  });

  it("the answer is absolute whatever came in — that is the whole contract", () => {
    for (const value of [".", "./agent-comms", "../a/b", "agent-comms/"]) {
      expect(resolveMailRoot(value, "/base/dir").startsWith("/")).toBe(true);
    }
  });

  // The base is a parameter so the resolution can be told without moving the process,
  // and the default is what the caller's shell meant: `process.cwd()`.
  it("defaults to the process's own directory", () => {
    expect(resolveMailRoot("agent-comms")).toBe(`${process.cwd()}/agent-comms`);
  });
});
