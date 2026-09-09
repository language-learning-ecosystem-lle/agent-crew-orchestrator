/**
 * THE PROCESS TEST OF `zones check` — the guard against a REAL git index, because all
 * three ways a foreign-zone change walked past the first version of it lived in the
 * gap between the pure verdict (`pathsOutsideZones`, unit-tested and always right) and
 * the list of paths handed to it (curator's findings, thread 020).
 *
 * That is the same class as the `GIT_DIR` defect this package already caught the hard
 * way: the guard did not say the wrong thing, it silently had nothing to say. A unit
 * test on the argv shape states the intent; only git itself proves that a deletion, a
 * rename out of the zone and a non-ASCII filename arrive as paths the guard can match.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { WORKSPACE_PAIR_SEPARATOR } from "../orchestrator/workspace.js";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const FOREIGN = "apps/acme-service";

const CONFIG = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  mail: { branch: "comms", dir: "agent-comms" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "the stream",
      zones: { writes: [], forbidden: [FOREIGN] },
    },
    // A role shaped like the live `curator` of 2026-08-18 (thread 010): a NON-EMPTY
    // `writes` naming a few documents, and a `forbidden` naming the neighbour's code.
    {
      id: "curator",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "c" },
      summary: "the mail",
      zones: { writes: ["docs/roles", "PROTOCOL.md"], forbidden: ["packages"] },
    },
  ],
};

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });

const file = (repo: string, path: string, text: string): void => {
  const full = join(repo, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text, "utf8");
};

/** A repository with the config committed and both zones populated. */
const repoWithHistory = (): string => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  file(repo, `${FOREIGN}/main.py`, "print(1)\n");
  file(repo, `${FOREIGN}/тест.py`, "print(2)\n");
  file(repo, "packages/agent-protocol/src/own.ts", "export const a = 1;\n");
  file(repo, "biome.json", "{}\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  return repo;
};

const run = (repo: string, args: readonly string[]): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [CLI, "zones", "check", "--ref", "HEAD", "--repo", repo, ...args],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: sandbox(configHomeInside(repo)),
      },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const check = (repo: string, role = "dev-core"): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [CLI, "zones", "check", "--ref", "HEAD", "--repo", repo, "--role", role, "--staged"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: sandbox(configHomeInside(repo)) },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

describe("zones check — the staged paths of a change against the role's zone", () => {
  it("a DELETION in a foreign zone is refused (the ACMRT filter used to hide it)", () => {
    const repo = repoWithHistory();
    git(repo, "rm", "-q", `${FOREIGN}/main.py`);

    const result = check(repo);

    expect(result.code).toBe(1);
    expect(result.out).toContain(`${FOREIGN}/main.py`);
  });

  it("a RENAME OUT of a foreign zone is refused by its source side", () => {
    // Rename detection reports only the destination — which is in the role's OWN
    // zone — so the change read as legal while a foreign file left its directory.
    const repo = repoWithHistory();
    git(repo, "mv", `${FOREIGN}/main.py`, "packages/agent-protocol/main.py");

    const result = check(repo);

    expect(result.code).toBe(1);
    expect(result.out).toContain(`${FOREIGN}/main.py`);
  });

  it("a NON-ASCII path in a foreign zone is refused (core.quotePath used to hide it)", () => {
    const repo = repoWithHistory();
    file(repo, `${FOREIGN}/тест.py`, "print(3)\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(1);
    expect(result.out).toContain("тест.py");
  });

  it("the ordinary path stays green: a change inside the role's own zone passes", () => {
    const repo = repoWithHistory();
    file(repo, "packages/agent-protocol/src/own.ts", "export const a = 2;\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(0);
    expect(result.out).toContain("none under a forbidden prefix");
  });

  it("a NON-EMPTY writes narrows nothing — a path outside it and outside forbidden is green", () => {
    // THE MEASUREMENT OF 2026-08-18 (thread 010), reproduced against a real index:
    // `curator` declares `writes` = two documents, and the door passed `biome.json`,
    // which is in neither list. `forbidden` is the whole verdict and `writes` is
    // prose; flipping that changes what every role may write de facto and is john's
    // decision, so the fact is nailed down here rather than left to be re-measured.
    const repo = repoWithHistory();
    file(repo, "biome.json", '{ "x": 1 }\n');
    git(repo, "add", "-A");

    const result = check(repo, "curator");

    expect(result.code).toBe(0);
    expect(result.out).toContain("none under a forbidden prefix");
    expect(result.out).toContain("narrows nothing");
  });

  it("a BASE a version behind is still read — the door of a version-bumping PR is not red by construction", () => {
    // Doors 2 and 3 point at a ref the change has not landed in yet, so on a PR that
    // bumps `protocolVersion` the base declares the OLD number while the binary
    // running the check writes the new one. Before the policy intent the version
    // gate refused before the zones were ever compared, and the guard was red on
    // exactly the class of change that touches the protocol's own shape.
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify({ ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION - 1 }, null, 2)}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base one version behind");
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");

    const result = check(repo);

    // The verdict is the ZONES one, not a version complaint — and the skew is named.
    expect(result.code).toBe(1);
    expect(result.out).toContain(`${FOREIGN}/main.py`);
    expect(result.out).toContain(`declares protocol version ${CURRENT_PROTOCOL_VERSION - 1}`);
  });

  it("a BASE NEWER than the binary is read too — a rebase is what the other end of the same skew looks like", () => {
    // Until thread 037 this halted with "restart required", and the asymmetry was
    // right for a reader of DATA: a shape the package has never seen cannot be guessed
    // at. This reader guesses at nothing — it takes the zones and leaves the rest of
    // the file alone — and a branch whose base moved ahead is the ordinary case.
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify(
        {
          ...CONFIG,
          protocolVersion: CURRENT_PROTOCOL_VERSION + 1,
          whatTheNewerPackageAdded: { stalled: true },
        },
        null,
        2,
      )}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base ahead");
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(1);
    expect(result.out).toContain(`${FOREIGN}/main.py`);
    expect(result.out).toContain(`declares protocol version ${CURRENT_PROTOCOL_VERSION + 1}`);
  });

  it("A BASE WHOSE FORM MOVED gives the SAME verdict — the acceptance of thread 037", () => {
    // The case `tolerateOlder` could never close, and the reason the thread exists: a
    // bump of the FORM (a section renamed, a required section gone, a key nobody in
    // this build has heard of) failed in the strict parse BEFORE the version was ever
    // compared, so the complaint named a field of a config that is perfectly valid at
    // its own version. Same base, same staged path, same verdict as the plain case.
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
    git(repo, "init", "-q", "-b", "main");
    const { mail: _renamedAway, ...withoutMail } = CONFIG;
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify(
        {
          ...withoutMail,
          protocolVersion: CURRENT_PROTOCOL_VERSION + 1,
          // the section renamed (case D) and a required one gone (case C), plus keys
          // this build has never heard of at the root, on the role and inside `zones`
          post: { branch: "comms", dir: "agent-comms" },
          somethingAddedLater: true,
          roles: [
            {
              ...CONFIG.roles[0],
              inventedLater: "x",
              zones: { ...CONFIG.roles[0]?.zones, alsoInventedLater: ["nothing"] },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base at another shape");
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(1);
    expect(result.out).toContain(`${FOREIGN}/main.py`);
    expect(result.out).toContain("only the policy fields are read");
    // NOT a complaint about a field name: that was the defect.
    expect(result.out).not.toContain("Unrecognized key");
  });

  it("still refuses BY DATA when the field it came for is not there at all", () => {
    // The honest half of the strict parse, kept: a base whose `roles` moved somewhere
    // this build cannot follow is a refusal — by the data, naming the field, and not
    // by the version number.
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
    git(repo, "init", "-q", "-b", "main");
    const { roles: _moved, ...withoutRoles } = CONFIG;
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify({ ...withoutRoles, participants: CONFIG.roles }, null, 2)}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base without roles");
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(2);
    expect(result.out).toContain("roles");
  });

  // THE SILENT SCOPE OF `--paths` (thread 033, curator's measurement on 396a260). The
  // flag was read by `flag`, which takes argv[at + 1] and stops, so the space form
  // handed the door ONE path and the door answered green about "1 path(s)" — with a
  // FORBIDDEN path sitting unjudged in second position. These are written against the
  // outcome, not the parser: what is guarded is that the number in the answer equals
  // the number of paths named, in either form.
  describe("--paths judges every path it was named, in both forms", () => {
    const NAMED = [`${FOREIGN}/main.py`, "packages/agent-protocol/src/own.ts", "biome.json"];

    it("the SPACE form refuses a forbidden path in second position", () => {
      const repo = repoWithHistory();

      const result = run(repo, [
        "--role",
        "curator",
        "--paths",
        "PROTOCOL.md",
        "packages/agent-protocol/src/own.ts",
        "biome.json",
      ]);

      // Before the fix: exit 0, "1 path(s) … none under a forbidden prefix".
      expect(result.code).toBe(1);
      expect(result.out).toContain("packages/agent-protocol/src/own.ts");
    });

    it("space and comma give the same verdict, byte for byte — refusing", () => {
      const repo = repoWithHistory();

      const spaced = run(repo, ["--role", "dev-core", "--paths", ...NAMED]);
      const commas = run(repo, ["--role", "dev-core", "--paths", NAMED.join(",")]);

      expect(spaced.code).toBe(1);
      expect(spaced.out).toContain(`${FOREIGN}/main.py`);
      // The comma form is what the reviewer's reports and curator's guard traces are
      // read from: it does not move in a single byte.
      expect(commas).toEqual(spaced);
    });

    it("space and comma give the same verdict, byte for byte — passing, and count ALL of them", () => {
      const repo = repoWithHistory();
      const allowed = ["PROTOCOL.md", "docs/roles/dev-core.md", "biome.json"];

      const spaced = run(repo, ["--role", "curator", "--paths", ...allowed]);
      const commas = run(repo, ["--role", "curator", "--paths", allowed.join(",")]);

      expect(spaced.code).toBe(0);
      // The green line used to say "1 path(s)" here, which is the whole defect: a count
      // that does not match what was named is a door reporting on a scope of its own.
      expect(spaced.out).toContain("3 path(s) of 'curator'");
      expect(commas).toEqual(spaced);
    });

    it("a --paths that names nothing is a refusal, not an empty green list", () => {
      const repo = repoWithHistory();

      const result = run(repo, ["--role", "dev-core", "--paths"]);

      expect(result.code).toBe(2);
      expect(result.out).toContain("--paths was given nothing to name");
    });
  });

  it("a role whose zone bans nothing is refused nothing — the stated default", () => {
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
    git(repo, "init", "-q", "-b", "main");
    const { zones: _dropped, ...role } = CONFIG.roles[0] as Record<string, unknown>;
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify({ ...CONFIG, roles: [role] }, null, 2)}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(0);
  });
});

/**
 * `--role-from-workspace` AGAINST THE THREE FORMS A CHECKOUT TAKES ON THE BOX (thread
 * 178; the field measurement is thread 177, msg-002 of 2026-09-08 on base `1bac6218`).
 *
 * THE DEFECT THIS SUITE HOLDS DOWN, in its own numbers: one command, one FORBIDDEN path,
 * two trees — `.worktrees/dev-core` refused it (exit 1) and `.worktrees/dev-core-177-probe`
 * passed it (exit 0, "is not a role workspace, the guard does not apply"). A guard that
 * enforces zones only in the directories where nobody renamed anything is not a guard,
 * and the silent half of it is the dangerous half: the note reads like "nothing to check
 * here" to a hook and to a human alike.
 *
 * It is a PROCESS test and not a unit because the classification was never what was
 * broken — `workspaceRoleOf` answered exactly what it promised. What was broken is what
 * this command DID with the answer, and that lives between the config loader, `repoOf` of
 * the parent tree and the exit code, none of which a unit on the pure function reaches.
 */
describe("zones check --role-from-workspace — the class of the tree it stands in", () => {
  /** The same config with R17's workspaces DECLARED: without them no tree is anybody's. */
  const WITH_WORKSPACES = {
    ...CONFIG,
    orchestrator: {
      state: ".orchestrator",
      mailCheckout: "mailco",
      ref: "HEAD",
      workdir: { branch: "main", worktrees: ".worktrees" },
    },
  };

  const boxWithWorkspaces = (): string => {
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-ws-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify(WITH_WORKSPACES, null, 2)}\n`,
    );
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    return repo;
  };

  /** A linked worktree at `<repo>/<where>`, detached at the base like the circuit's own. */
  const worktree = (repo: string, where: string): string => {
    const path = join(repo, where);
    git(repo, "worktree", "add", "-q", "--detach", path);
    return path;
  };

  /** The forbidden path, staged in THAT tree — the same change in every case below. */
  const stageForbidden = (tree: string): void => {
    file(tree, `${FOREIGN}/main.py`, "print(99)\n");
    git(tree, "add", "-A");
  };

  /**
   * Run the door the way a pre-commit hook does: from the tree, with no `--role` and no
   * `--repo` — everything it knows about whose commit this is comes from the directory.
   */
  const inTree = (repo: string, cwd: string): { code: number; out: string } => {
    const done = spawnSync(
      TSX,
      [CLI, "zones", "check", "--ref", "HEAD", "--role-from-workspace", "--staged"],
      { cwd, encoding: "utf8", timeout: 60_000, env: sandbox(configHomeInside(repo)) },
    );
    return { code: done.status ?? -1, out: `${done.stdout ?? ""}${done.stderr ?? ""}` };
  };

  it("(в) in a ROLE'S workspace the forbidden path is refused — unchanged", () => {
    const repo = boxWithWorkspaces();
    const mine = worktree(repo, ".worktrees/dev-core");
    stageForbidden(mine);

    const said = inTree(repo, mine);

    expect(said.code).toBe(1);
    expect(said.out).toContain("'dev-core' may not write these paths");
    expect(said.out).toContain(`${FOREIGN}/main.py`);
  });

  it("(в) in a PAIR'S workspace it is refused the same way — the acceptance of thread 177", () => {
    // THE MEASUREMENT THIS ONE ANSWERS DIRECTLY (thread 177, msg-002 of 2026-09-08, base
    // `1bac6218`): the same command, the same FORBIDDEN path, a tree whose name carried a
    // thread — exit 0, "the guard does not apply". Moving the key of the workspace to the
    // pair without this is the one door that enforces zones, disarmed and green.
    //
    // It is a PROCESS test on purpose and the statement of work says why: the diff of
    // `zones check` itself is zero lines, so "no hunks at the consumer" proves nothing
    // here. What is being measured is the whole path from the directory the hook stands
    // in, through the config loader and `repoOf` of the parent tree, to the exit code.
    const repo = boxWithWorkspaces();
    const pair = worktree(
      repo,
      `.worktrees/dev-core${WORKSPACE_PAIR_SEPARATOR}177-workspace-per-pair`,
    );
    stageForbidden(pair);

    const said = inTree(repo, pair);

    // Byte for byte the verdict of case (в) above, on a tree of the other form.
    expect(said.code).toBe(1);
    expect(said.out).toContain("'dev-core' may not write these paths");
    expect(said.out).toContain(`${FOREIGN}/main.py`);
    // ...and not either of the two ways this used to end: the silent pass of the field
    // probe, and the refusal that would follow it once `unowned` became loud (#345) —
    // that one would be a door refusing EVERY pair's tree, which is the same outage
    // wearing the opposite sign.
    expect(said.out).not.toContain("the guard does not apply");
    expect(said.out).not.toContain("is not the workspace of any role");
  });

  it("(б) `<role>@` with no thread is NOT a pair — the name lies and the door says so", () => {
    // The boundary of the form, at the process level: the parse refuses an empty thread
    // (`workspacePairOf`), so a tree called `dev-core@` is not dev-core's workspace and
    // must not be judged as if it were. Without this the separator alone would be enough
    // to claim a role's zones — a tree anybody can create by hand.
    const repo = boxWithWorkspaces();
    const lying = worktree(repo, `.worktrees/dev-core${WORKSPACE_PAIR_SEPARATOR}`);
    stageForbidden(lying);

    const said = inTree(repo, lying);

    expect(said.code).toBe(2);
    expect(said.out).toContain("is not the workspace of any role");
    expect(said.out).not.toContain("the guard does not apply");
  });

  it("(б) in a tree under the workspaces that is NOBODY'S the door REFUSES, and names it", () => {
    // The exact form of the field probe: a linked worktree beside the role's own, whose
    // name merely starts with a role id. On 1bac6218 this printed a note and exited 0.
    const repo = boxWithWorkspaces();
    const probe = worktree(repo, ".worktrees/dev-core-177-probe");
    stageForbidden(probe);

    const said = inTree(repo, probe);

    expect(said.code).not.toBe(0);
    expect(said.code).toBe(2);
    // Discipline 4 — the tree, the cause and the repair, each by name.
    expect(said.out).toContain(probe);
    expect(said.out).toContain("is not the workspace of any role");
    expect(said.out).toContain("--role <id>");
    expect(said.out).toContain("dev-core");
    // ...and it must not be the sentence that used to let it through.
    expect(said.out).not.toContain("the guard does not apply");
  });

  it("(б) the MAIL checkout is the same class — the form that exists without any probe", () => {
    const repo = boxWithWorkspaces();
    const mail = worktree(repo, ".worktrees/comms");
    stageForbidden(mail);

    const said = inTree(repo, mail);

    expect(said.code).toBe(2);
    expect(said.out).toContain(mail);
    expect(said.out).toContain("is not the workspace of any role");
  });

  it("(а) a tree OUTSIDE the declared workspaces still passes, with a note", () => {
    // A human's own linked checkout: the layout claims nothing about it, and a refusal
    // here would be the guard reaching outside what it was given.
    const repo = boxWithWorkspaces();
    const aside = worktree(repo, "aside");
    stageForbidden(aside);

    const said = inTree(repo, aside);

    expect(said.code).toBe(0);
    expect(said.out).toContain(aside);
    expect(said.out).toContain("outside the declared workspaces");
  });

  it("(а) the HOME checkout passes with the note — not with git's answer to another question", () => {
    // Measured in the live contour on 2026-09-08: from the operator's own checkout this
    // door exited 2 saying "'/home/…/..' is not inside a git repository". The tree above
    // a home checkout is an ordinary directory, and blaming the caller's filesystem is a
    // refusal naming a cause it does not have (discipline 4). No repository above means
    // nothing above declares workspaces — the `outside` class, and its note.
    const repo = boxWithWorkspaces();
    stageForbidden(repo);

    const said = inTree(repo, repo);

    expect(said.code).toBe(0);
    expect(said.out).toContain("outside the declared workspaces");
    expect(said.out).not.toContain("is not inside a git repository");
  });

  it("no workspaces declared — the note stands and nothing is inferred from any path", () => {
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-ws-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
    file(repo, `${FOREIGN}/main.py`, "print(1)\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    const anywhere = join(repo, ".worktrees", "dev-core");
    git(repo, "worktree", "add", "-q", "--detach", anywhere);
    stageForbidden(anywhere);

    const said = inTree(repo, anywhere);

    expect(said.code).toBe(0);
    expect(said.out).toContain("no workspaces declared");
  });
});
