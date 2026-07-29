import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A guard against a defect that no ordinary tool reports (thread 023, review of PR #81):
 * ONE control byte written literally into a source file — a NUL that was meant to be the
 * escape sequence "\0" — makes git, GitHub and grep classify the whole blob as BINARY.
 * The code keeps working (V8 reads the byte and the escape as the same character), so
 * typecheck, lint and the tests all stay green while `git diff`, `git blame`, the file
 * view on GitHub and every future review of that file print "Binary files … differ".
 * It already cost one review round, which had to fetch the blob and hexdump it to read
 * the change at all. The blob stays binary forever, so the cheap place to catch this is
 * the commit that introduces it — hence a test over our own sources rather than a rule.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

const sourceFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });

describe("the package's own sources", () => {
  it("carry no NUL byte — the one character that makes git call a text file binary", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => readFileSync(path).includes(0))
      .map((path) => path.slice(SRC.length));

    expect(offenders).toEqual([]);
  });
});
