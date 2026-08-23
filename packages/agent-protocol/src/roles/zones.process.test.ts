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
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const FOREIGN = "apps/pronunciation-service";

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
