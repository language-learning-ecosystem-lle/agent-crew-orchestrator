/**
 * THE PURE HALF OF "THE RESTART DOES NOT DEPEND ON THE CALLER'S PATH" (thread 219).
 *
 * What is measured here is the DECISION — which candidate is taken, in which order, and
 * which of the two failures a spawn's answer is. Whether the real command then spawns the
 * resolved path is a fact about processes and lives in `restart.process.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  classifyToolFailure,
  describeToolChoice,
  describeToolFailure,
  resolveTool,
} from "./tool-path.js";

const NODE = "/home/lle/.nvm/versions/node/v24.18.0/bin/node";

describe("resolveTool", () => {
  it("takes the tool beside the node binary, and never asks PATH after that", () => {
    const asked: string[] = [];
    const found = resolveTool({
      name: "pnpm",
      nodePath: NODE,
      path: "/usr/bin:/bin",
      isExecutable: (candidate) => {
        asked.push(candidate);
        return candidate.startsWith("/home/lle/.nvm");
      },
    });
    expect(found).toEqual({
      command: "/home/lle/.nvm/versions/node/v24.18.0/bin/pnpm",
      source: "beside-node",
      looked: ["/home/lle/.nvm/versions/node/v24.18.0/bin/pnpm"],
    });
    // The field failure was PATH being consulted at all: it did not have pnpm and the
    // box went down. Beside-node answering means PATH is not a premise of the restart.
    expect(asked).toEqual(["/home/lle/.nvm/versions/node/v24.18.0/bin/pnpm"]);
  });

  it("falls back to PATH, in PATH's own order, when nothing sits beside node", () => {
    const found = resolveTool({
      name: "git",
      nodePath: NODE,
      path: "/opt/none:/usr/local/bin:/usr/bin",
      isExecutable: (candidate) =>
        candidate === "/usr/bin/git" || candidate === "/usr/local/bin/git",
    });
    expect(found.command).toBe("/usr/local/bin/git");
    expect(found.source).toBe("path");
    expect(found.looked).toEqual([
      "/home/lle/.nvm/versions/node/v24.18.0/bin/git",
      "/opt/none/git",
      "/usr/local/bin/git",
    ]);
  });

  it("hands the bare name on when it finds nothing — a resolver is not a door", () => {
    const found = resolveTool({
      name: "pnpm",
      nodePath: NODE,
      path: "/usr/bin",
      isExecutable: () => false,
    });
    expect(found).toEqual({
      command: "pnpm",
      source: "unresolved",
      looked: ["/home/lle/.nvm/versions/node/v24.18.0/bin/pnpm", "/usr/bin/pnpm"],
    });
  });

  it("never resolves through an empty PATH entry — that is the cwd, i.e. who typed it", () => {
    const found = resolveTool({
      name: "pnpm",
      nodePath: NODE,
      path: ":/usr/bin:",
      isExecutable: (candidate) => candidate === "pnpm" || candidate === "/pnpm",
    });
    expect(found.source).toBe("unresolved");
    expect(found.looked).toEqual([
      "/home/lle/.nvm/versions/node/v24.18.0/bin/pnpm",
      "/usr/bin/pnpm",
    ]);
  });

  it("an absent PATH is not a crash — beside-node is still asked", () => {
    const found = resolveTool({
      name: "pnpm",
      nodePath: NODE,
      isExecutable: (candidate) => candidate.endsWith("/bin/pnpm"),
    });
    expect(found.source).toBe("beside-node");
  });
});

describe("classifyToolFailure", () => {
  it("a numeric status is a process that RAN and chose it", () => {
    expect(
      classifyToolFailure({ status: 1, stderr: " ERR_PNPM_NO_LOCKFILE \n frozen ", code: "ERR" }),
    ).toEqual({ kind: "exited", status: 1, said: "ERR_PNPM_NO_LOCKFILE frozen" });
  });

  it("ENOENT with no status is NO PROCESS — the '?' of the field line", () => {
    expect(
      classifyToolFailure({
        code: "ENOENT",
        message: "spawnSync pnpm ENOENT",
        status: undefined,
        signal: null,
      }),
    ).toEqual({ kind: "unspawned", code: "ENOENT", message: "spawnSync pnpm ENOENT" });
  });

  it("a signal is neither of the two — it ran, and nothing it chose ended it", () => {
    expect(classifyToolFailure({ status: null, signal: "SIGKILL", stdout: "half" })).toEqual({
      kind: "signalled",
      signal: "SIGKILL",
      said: "half",
    });
  });
});

describe("describeToolFailure", () => {
  const unresolved = resolveTool({
    name: "pnpm",
    nodePath: NODE,
    path: "/usr/bin:/bin",
    isExecutable: () => false,
  });

  it("says NO PROCESS RAN and names every place it looked", () => {
    const said = describeToolFailure({
      name: "pnpm",
      resolution: unresolved,
      failure: { kind: "unspawned", code: "ENOENT", message: "spawnSync pnpm ENOENT" },
    });
    expect(said).toContain("NO PROCESS RAN");
    expect(said).toContain("no executable 'pnpm'");
    expect(said).toContain("/home/lle/.nvm/versions/node/v24.18.0/bin/pnpm");
    expect(said).toContain("/usr/bin/pnpm");
    // The line that cost the field case said `code ?` and nothing else; the reader must
    // not be able to mistake this for the project's own refusal.
    expect(said).toContain("NOT a failure of the project");
    expect(said).not.toContain("code ?");
  });

  it("an exited process is named by its code and its own words, not by the lookup", () => {
    const said = describeToolFailure({
      name: "pnpm",
      resolution: {
        command: "/n/bin/pnpm",
        source: "beside-node",
        looked: ["/n/bin/pnpm"],
      },
      failure: { kind: "exited", status: 1, said: "ERR_PNPM_OUTDATED_LOCKFILE" },
    });
    expect(said).toBe("'/n/bin/pnpm' ran and exited 1: ERR_PNPM_OUTDATED_LOCKFILE");
    expect(said).not.toContain("Looked beside");
  });

  it("a silent process still says so — an empty tail is not an empty sentence", () => {
    expect(
      describeToolFailure({
        name: "git",
        resolution: { command: "/usr/bin/git", source: "path", looked: ["/usr/bin/git"] },
        failure: { kind: "exited", status: 128, said: "" },
      }),
    ).toBe("'/usr/bin/git' ran and exited 128 — it printed nothing");
  });

  it("the list of places is bounded — PATH is not", () => {
    const many = Array.from({ length: 9 }, (_, at) => `/p${at}`).join(":");
    const said = describeToolFailure({
      name: "pnpm",
      resolution: resolveTool({
        name: "pnpm",
        nodePath: NODE,
        path: many,
        isExecutable: () => false,
      }),
      failure: { kind: "unspawned", code: "ENOENT", message: "" },
    });
    expect(said).toContain("(and 4 more)");
    expect(said).not.toContain("/p8/pnpm");
  });
});

describe("describeToolChoice", () => {
  it("says which premise the step stands on", () => {
    expect(
      describeToolChoice({ command: "/n/bin/pnpm", source: "beside-node", looked: [] }),
    ).toContain("beside this node binary");
    expect(describeToolChoice({ command: "/usr/bin/git", source: "path", looked: [] })).toContain(
      "from PATH",
    );
    expect(
      describeToolChoice({ command: "pnpm", source: "unresolved", looked: ["/n/bin/pnpm"] }),
    ).toContain("BY NAME");
  });
});
