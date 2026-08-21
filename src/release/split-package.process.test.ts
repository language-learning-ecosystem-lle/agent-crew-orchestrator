/**
 * РЕЗ ПОДПАКЕТА, ПРОВЕРЕННЫЙ НА ЖИВОМ РЕПОЗИТОРИИ (тред 018). `scripts/split-package.sh`
 * режет `packages/agent-protocol` в тег, корень дерева которого — сам пакет: чужой
 * репозиторий ставит нас зависимостью `github:<owner>/<repo>#<tag>`, а она кладёт в
 * `node_modules/<name>` КОРЕНЬ репозитория, и корень-воркспейс потребителю не годится.
 *
 * Почему тест процессный, а не юнит: предмет здесь — git-операция над деревом. Юнит на
 * разборе аргументов сказал бы, что флаги прочитаны, и промолчал бы ровно о том, ради чего
 * скрипт существует, — что В КОРНЕ ТЕГА лежит package.json пакета. Поэтому каждый случай
 * поднимает временный репозиторий и спрашивает git о результате.
 *
 * Отказы проверяются ПО ТЕКСТУ: дверь, которая молчит (или отказывает безымянно), хуже
 * отсутствующей — рез идёт руками на каждом бампе, и человек за ним обязан прочитать в
 * отказе, что чинить.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../../scripts/split-package.sh", import.meta.url));

const made: string[] = [];

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-08-21T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-21T00:00:00Z",
    },
  });

/**
 * A repository shaped like this one: a workspace root plus the package under a prefix. The
 * root manifest carries a DIFFERENT name on purpose — that is the whole defect the cut is
 * against, and the test would not see a cut that quietly kept the root.
 */
const repoWithPackage = (version = "0.2.0"): string => {
  const dir = mkdtempSync(join(tmpdir(), "split-package-"));
  made.push(dir);
  git(dir, "init", "--quiet", "--initial-branch=main", ".");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "test");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "the-workspace", private: true }),
  );
  writeFileSync(join(dir, "tsconfig.base.json"), "{}\n");
  mkdirSync(join(dir, "packages/thing/src"), { recursive: true });
  writeFileSync(
    join(dir, "packages/thing/package.json"),
    JSON.stringify({ name: "thing", version, exports: { ".": "./src/index.ts" } }),
  );
  writeFileSync(join(dir, "packages/thing/src/cli.ts"), "export const cli = () => 0;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "init");
  return dir;
};

const split = (
  cwd: string,
  ...args: readonly string[]
): { readonly ok: boolean; readonly out: string } => {
  try {
    return { ok: true, out: execFileSync("bash", [SCRIPT, ...args], { cwd, encoding: "utf8" }) };
  } catch (error) {
    const said = error as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${said.stdout ?? ""}${said.stderr ?? ""}${said.message}` };
  }
};

describe("scripts/split-package.sh", () => {
  it("cuts a tag whose tree root IS the package", () => {
    const repo = repoWithPackage();
    const run = split(repo, "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok, run.out).toBe(true);

    const top = git(repo, "ls-tree", "--name-only", "thing-v0.2.0").trim().split("\n").sort();
    expect(top).toEqual(["package.json", "src"]);
    expect(JSON.parse(git(repo, "show", "thing-v0.2.0:package.json")).name).toBe("thing");
    expect(git(repo, "show", "thing-v0.2.0:src/cli.ts")).toContain("export const cli");
    // The root of the repository must NOT have travelled with it.
    expect(() => git(repo, "cat-file", "-e", "thing-v0.2.0:tsconfig.base.json")).toThrow();
    expect(() => git(repo, "cat-file", "-e", "thing-v0.2.0:packages")).toThrow();
  });

  it("refuses without --tag, and says why the tag is needed", () => {
    const run = split(repoWithPackage(), "--prefix", "packages/thing");
    expect(run.ok).toBe(false);
    expect(run.out).toContain("--tag обязателен");
  });

  it("refuses a prefix that is not there, naming the prefix", () => {
    const run = split(repoWithPackage(), "--tag", "thing-v0.2.0", "--prefix", "packages/nope");
    expect(run.ok).toBe(false);
    expect(run.out).toContain("packages/nope");
  });

  it("refuses a tag that disagrees with the package version, naming both", () => {
    const run = split(
      repoWithPackage("0.2.0"),
      "--tag",
      "thing-v9.9.9",
      "--prefix",
      "packages/thing",
    );
    expect(run.ok).toBe(false);
    expect(run.out).toContain("thing-v9.9.9");
    expect(run.out).toContain("version='0.2.0'");
    expect(run.out).toContain("'thing-v0.2.0'");
  });

  it("refuses to move a tag that already exists", () => {
    const repo = repoWithPackage();
    expect(split(repo, "--tag", "thing-v0.2.0", "--prefix", "packages/thing").ok).toBe(true);
    const again = split(repo, "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(again.ok).toBe(false);
    expect(again.out).toContain("уже есть");
  });

  it("does not push without --push, and says the command that would", () => {
    const run = split(repoWithPackage(), "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("git push origin refs/tags/thing-v0.2.0");
  });
});
