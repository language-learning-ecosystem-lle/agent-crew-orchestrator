/**
 * THE PULL REQUEST TEMPLATE OF THIS REPOSITORY, JUDGED BY THE READERS THAT ACTUALLY PARSE IT
 * — a claim about `.github/pull_request_template.md`, held in the generic package for the
 * reason `workflow-signatures.test.ts` and `devops-declared.test.ts` hold theirs: the
 * repository serves itself, and the door that reads a PR description is this package.
 *
 * THE DEFECT IT COMES FROM (thread `052-pr-template`, john on a live PR of 2026-08-30). The
 * machine-readable `thread:` and `role:` lines had drifted out of PR descriptions — «раньше
 * все писали в шапке, потом то в шапке, то в подвале, а теперь вообще перестали». The cause
 * is that the FORM OF A DESCRIPTION was written nowhere: the commit-title format is normed,
 * the body was habit copied between roles, and an unwritten habit dissolves. John's decision
 * was a template rather than a norm — a norm has to be remembered, a template arrives by
 * itself and has to be deliberately deleted.
 *
 * WHY THIS FILE IS TESTED AT ALL, being prose. A template at the wrong path looks installed
 * and does nothing — the class already caught here on the systemd units. And its placeholder
 * is not decoration either: three separate readers parse those two lines, each with its own
 * grammar, and a placeholder that HAPPENS to parse is worse than a missing line, because
 * every one of them then acts on a value nobody meant:
 *
 *   - {@link threadOfDescription} (merge-gate guard 3) — `^thread:\s*(\S+)\s*$`;
 *   - `.github/workflows/*.yml`, the CI and merge notifiers — a `grep -oiE` per field, and
 *     `role:` is what tells them WHOSE turn it is after the run and after the merge.
 *
 * So the assertions below run the door's own function and the workflows' OWN grep patterns,
 * lifted out of the workflow files rather than restated here — a second copy of a pattern is
 * the class this package spends its whole existence avoiding.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseProtocolConfig } from "../config/config.js";
import { powerDocuments, threadOfDescription, touchedPowerDocuments } from "./gate.js";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const CONFIG_PATH = fileURLToPath(new URL("agent-protocol.json", REPO_ROOT));
const WORKFLOWS_DIR = fileURLToPath(new URL(".github/workflows/", REPO_ROOT));

/** THE path GitHub substitutes from. A template one directory over is a file nobody reads. */
const TEMPLATE_PATH = ".github/pull_request_template.md";

const template = readFileSync(fileURLToPath(new URL(TEMPLATE_PATH, REPO_ROOT)), "utf8");
const lines = template.split("\n");

/** The same description with both fields filled in the way this very PR fills them. */
const filled = template
  .replace(/^thread:.*$/m, "thread: 052-pr-template")
  .replace(/^role:.*$/m, "role: dev-core");

/**
 * The `grep -oiE` patterns the workflows read a description with, taken FROM the workflows.
 * `THREAD=$(printf '%s' "$PR_BODY" | grep -oiE '…')` — the field name and the pattern.
 */
const workflowReaders = (): readonly { file: string; field: string; pattern: string }[] => {
  const found: { file: string; field: string; pattern: string }[] = [];
  for (const file of readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml"))) {
    const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
    const matches = text.matchAll(/^\s*(THREAD|ROLE)=\$\([^\n]*grep -oiE '([^']+)'/gm);
    for (const match of matches) {
      found.push({ file, field: match[1] as string, pattern: match[2] as string });
    }
  }
  return found;
};

/** `grep -oiE <pattern>` over a body, exactly as the workflow runs it. Empty = no match. */
const grepField = (pattern: string, body: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "pr-template-"));
  const path = join(directory, "body.md");
  writeFileSync(path, body);
  const result = spawnSync("grep", ["-oiE", pattern, path], { encoding: "utf8" });
  // grep exits 1 on "no lines selected" — a fact here, not a failure. Anything above 1 is.
  expect(result.status === 0 || result.status === 1).toBe(true);
  return (result.stdout ?? "").trim();
};

const readers = workflowReaders();

describe("the pull request template of this repository", () => {
  it("lies at the path GitHub substitutes from, and is not empty", () => {
    expect(template.length).toBeGreaterThan(0);
  });

  it("puts the two machine-readable fields FIRST, before any prose", () => {
    // The whole of john's decision: in the footer they are found by nobody. Line 1 and 2,
    // no blank line and no heading in front of them.
    expect(lines[0]?.startsWith("thread:")).toBe(true);
    expect(lines[1]?.startsWith("role:")).toBe(true);
  });

  it("is read by the door as UNFILLED — the placeholder is never mistaken for a thread", () => {
    // A placeholder that parsed would give guard 3 a thread that does not exist, printed as
    // if the ascent were named. Refusing by name is the cheaper failure of the two.
    expect(threadOfDescription(template)).toBeUndefined();
  });

  it("is read by the door once filled in — the same two lines, with values", () => {
    expect(threadOfDescription(filled)).toBe("052-pr-template");
  });

  it("is looked at by every workflow reader there is — the patterns are lifted, not restated", () => {
    // A green sweep over an empty list would say nothing at all.
    expect(readers.length).toBeGreaterThan(0);
    expect(new Set(readers.map((reader) => reader.field))).toEqual(new Set(["THREAD", "ROLE"]));
  });

  for (const reader of readers) {
    it(`is unparseable to ${reader.file}'s ${reader.field} reader while it stands unfilled`, () => {
      expect(grepField(reader.pattern, template)).toBe("");
    });

    it(`is parsed by ${reader.file}'s ${reader.field} reader once it is filled in`, () => {
      const expected = reader.field === "THREAD" ? "052-pr-template" : "dev-core";
      expect(grepField(reader.pattern, filled)).toContain(expected);
    });
  }

  it("is NOT a document of power — no button of john's is needed to merge it", () => {
    // Point 2 of the statement, checked by fact rather than by reading the config with an
    // eye: the derived list is what guard 4 judges by, and `.github/workflows` being on it
    // does not put a file that merely lives in `.github` there too.
    const documents = powerDocuments({
      roles: parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8"))).roles,
      configPath: "agent-protocol.json",
      configured: parseProtocolConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8"))).powerDocuments,
    });

    expect(touchedPowerDocuments({ changedPaths: [TEMPLATE_PATH], powerDocs: documents })).toEqual(
      [],
    );
  });
});
