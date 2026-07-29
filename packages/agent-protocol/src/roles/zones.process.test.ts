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
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  return repo;
};

const check = (repo: string): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [CLI, "zones", "check", "--ref", "HEAD", "--repo", repo, "--role", "dev-core", "--staged"],
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
    expect(result.out).toContain("inside its zone");
  });

  it("a BASE a version behind is still read — the door of a version-bumping PR is not red by construction", () => {
    // Doors 2 and 3 point at a ref the change has not landed in yet, so on a PR that
    // bumps `protocolVersion` the base declares the OLD number while the binary
    // running the check writes the new one. Before this was tolerated the version
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

  it("a BASE NEWER than the binary still halts the door — an unknown shape is not guessed at", () => {
    const repo = mkdtempSync(join(tmpdir(), "agent-protocol-zones-"));
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(
      join(repo, "agent-protocol.json"),
      `${JSON.stringify({ ...CONFIG, protocolVersion: CURRENT_PROTOCOL_VERSION + 1 }, null, 2)}\n`,
    );
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base ahead");
    file(repo, "packages/agent-protocol/src/own.ts", "export const a = 2;\n");
    git(repo, "add", "-A");

    const result = check(repo);

    expect(result.code).toBe(2);
    // The repair, in the words the verdict now leads with (thread 023): a build behind
    // the data is restarted on the merged code, whoever is running it.
    expect(result.out).toContain("restart required");
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
