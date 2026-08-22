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
import { execFileSync, spawnSync } from "node:child_process";
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
const repoWithPackage = (version = "0.2.0", schemaVersion?: number): string => {
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
  if (schemaVersion !== undefined) {
    mkdirSync(join(dir, "packages/thing/src/schema"), { recursive: true });
    writeFileSync(
      join(dir, "packages/thing/src/schema/version.ts"),
      `export const CURRENT_PROTOCOL_VERSION = ${schemaVersion};\n`,
    );
  }
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "init");
  return dir;
};

/**
 * The line moved on while a branch stayed behind — the defect of 2026-08-21 in miniature:
 * `stale` is the branch head one would cut from, `main` carries work merged after it. The
 * `touching` argument says whether that work is inside the package or outside it: only the
 * first kind changes the artifact, and the door is expected to tell those two apart.
 */
const repoWithMovedLine = (touching: "package" | "elsewhere"): string => {
  const dir = repoWithPackage();
  git(dir, "branch", "stale");
  const path = touching === "package" ? "packages/thing/src/notify.ts" : "docs/notes.md";
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, path), "export const notify = () => 0;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "fix(notify): the work that must not be lost");
  return dir;
};

/** Both streams matter: the refusals go to stderr, and so does the --allow-behind warning. */
const split = (
  cwd: string,
  ...args: readonly string[]
): { readonly ok: boolean; readonly out: string } => {
  const run = spawnSync("bash", [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
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

  it("refuses a revision that does not carry the whole line, naming the missing commit", () => {
    const repo = repoWithMovedLine("package");
    const run = split(
      repo,
      "--tag",
      "thing-v0.2.0",
      "--prefix",
      "packages/thing",
      "--ref",
      "stale",
      "--base",
      "main",
    );
    expect(run.ok).toBe(false);
    expect(run.out).toContain("НЕ несёт линию 'main'");
    expect(run.out).toContain("fix(notify): the work that must not be lost");
    // Refusal means refusal: no tag was left behind pointing at the stale cut.
    expect(git(repo, "tag", "--list").trim()).toBe("");
  });

  it("cuts a revision behind the line under --allow-behind, and still says what is missing", () => {
    const repo = repoWithMovedLine("package");
    const run = split(
      repo,
      "--tag",
      "thing-v0.2.0",
      "--prefix",
      "packages/thing",
      "--ref",
      "stale",
      "--base",
      "main",
      "--allow-behind",
    );
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("ВНИМАНИЕ");
    expect(run.out).toContain("fix(notify): the work that must not be lost");
    expect(git(repo, "tag", "--list").trim()).toBe("thing-v0.2.0");
    expect(() => git(repo, "cat-file", "-e", "thing-v0.2.0:src/notify.ts")).toThrow();
  });

  it("does not refuse when the line moved outside the package, and says so", () => {
    const repo = repoWithMovedLine("elsewhere");
    const run = split(
      repo,
      "--tag",
      "thing-v0.2.0",
      "--prefix",
      "packages/thing",
      "--ref",
      "stale",
      "--base",
      "main",
    );
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("те коммиты не трогают");
    expect(git(repo, "tag", "--list").trim()).toBe("thing-v0.2.0");
  });

  it("says out loud when the base line is not in the repository at all", () => {
    const run = split(repoWithPackage(), "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("ПРОПУЩЕНА");
    expect(run.out).toContain("origin/main");
  });

  /**
   * ЧИСЛО СХЕМЫ В ВЫВОДЕ РЕЗА (тред 028). Номер тега — версия ПАКЕТА, и по ней не видно,
   * сдвинулась ли под ним схема протокола: так `v0.2.1` (17) → `v0.2.2` (18) уехало в
   * LLE под заголовком чистого релизного бампа, и потребитель узнал о сдвиге красным CI
   * на живом `main`. Проверяется именно ВЫВОД процесса: число, известное только функции
   * внутри, руку, ведущую бамп, ни о чём не предупреждает.
   */
  it("says which protocol schema version the tag writes — in the output of the cut itself", () => {
    const repo = repoWithPackage("0.2.0", 18);
    const run = split(repo, "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("protocolVersion этот тег пишет: 18");
    // И в ИТОГОВОЙ строке — её копируют в тред как объявление тега.
    expect(run.out).toContain("тег 'thing-v0.2.0' создан");
    expect(run.out).toMatch(/создан на [0-9a-f]+ \(пакет thing@0\.2\.0, protocolVersion 18\)/);
    // Плюс команда сверки с потребителем, названная поимённо.
    expect(run.out).toContain("schema version --package-ref 'thing-v0.2.0'");
  });

  it("says out loud when the cut declares no schema version at all, instead of printing nothing", () => {
    const run = split(repoWithPackage(), "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("версию схемы протокола не объявляет");
  });

  it("refuses a version.ts whose declaration cannot be read, rather than cutting a silent tag", () => {
    const repo = repoWithPackage("0.2.0", 18);
    writeFileSync(
      join(repo, "packages/thing/src/schema/version.ts"),
      "export const CURRENT_PROTOCOL_VERSION = later;\n",
    );
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "chore: the number stops being a number");

    const run = split(repo, "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok).toBe(false);
    expect(run.out).toContain("CURRENT_PROTOCOL_VERSION");
    expect(git(repo, "tag", "--list").trim()).toBe("");
  });

  it("does not push without --push, and says the command that would", () => {
    const run = split(repoWithPackage(), "--tag", "thing-v0.2.0", "--prefix", "packages/thing");
    expect(run.ok, run.out).toBe(true);
    expect(run.out).toContain("git push origin refs/tags/thing-v0.2.0");
  });
});
