/**
 * THE JOINT, AND THE ONLY PLACE IT CAN BE SEEN (thread `097-conflict-has-no-signal`, half 2).
 *
 * The rule is covered by `mergeability-watch.test.ts` and a unit cannot go further: what is
 * asked here is whether a letter LANDS — in the right thread, from the right identity, with
 * the turn on the role of the pull request's description — and whether the mark that keeps it
 * quiet SURVIVES THE PROCESS. Both questions are about the seam between the pure rule, `gh`
 * and the mail, and a mock of any of the three would answer a different question.
 *
 * So: a real checkout of the mail with a real remote to push to, a `gh` stub that answers a
 * SCRIPT (a different word per call) and counts its calls, and the command run as a process —
 * twice, because "said once per break" is a statement about two runs and nothing less.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { CURRENT_PROTOCOL_VERSION } from "../schema/version.js";
import { configHomeInside, sandbox } from "../testing/process-sandbox.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const ROLES = [
  { id: "john", kind: "human", status: "active", wake: { mode: "self" }, summary: "the owner" },
  {
    id: "dev-core",
    kind: "claude-code",
    status: "active",
    wake: { mode: "watch", session: "s" },
    summary: "the stream",
  },
  {
    id: "github",
    kind: "github-actions",
    status: "active",
    wake: { mode: "event" },
    summary: "the platform's own voice",
  },
];

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

/**
 * A box with everything the seam needs: a repository carrying the config, a MAIL CHECKOUT of
 * its own with a bare origin behind it (delivery commits AND pushes — a checkout without a
 * remote would test the refusal, not the delivery), one thread, and a `gh` on the path whose
 * answers are a script.
 */
const box = (options: { readonly words: readonly string[]; readonly body?: string }) => {
  const home = mkdtempSync(join(tmpdir(), "agent-protocol-mergeability-"));
  const repo = join(home, "repo");
  mkdirSync(repo);
  writeFileSync(
    join(repo, "agent-protocol.json"),
    `${JSON.stringify(
      {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        mail: { branch: "comms", dir: "agent-comms" },
        orchestrator: {
          state: ".orchestrator",
          mailCheckout: ".worktrees/comms",
          ref: "origin/main",
        },
        roles: ROLES,
      },
      null,
      2,
    )}\n`,
  );
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "config");

  // The mail: a bare origin, a checkout on the mail branch, one thread with one message.
  const origin = join(home, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "comms", origin]);
  const mail = join(home, "mail");
  execFileSync("git", ["init", "-q", "-b", "comms", mail]);
  git(mail, "remote", "add", "origin", origin);
  const root = join(mail, "agent-comms");
  const thread = "097-conflict-has-no-signal";
  mkdirSync(join(root, thread, "messages"), { recursive: true });
  writeFileSync(
    join(root, thread, "_meta.md"),
    "---\ntitle: T\nparticipants: dev-core, john\nstatus: open\n---\n",
  );
  writeFileSync(
    join(root, thread, "messages", "2026-09-03T10-00-00Z-dev-core.md"),
    "---\nfrom: dev-core\nworker: claude-code\ndate: 2026-09-03T10:00:00Z\nexpects: none\nwaiting-on: john\n---\n\nThe body.\n",
  );
  git(mail, "add", ".");
  git(mail, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "mail");
  git(mail, "push", "-q", "origin", "comms");

  // THE STUB ANSWERS A SCRIPT AND COUNTS ITS CALLS. One word per call, in order: a stub that
  // repeated itself would let a pass that never asks a second time look exactly like a pass
  // that does, and "did it ask again" is half of what this seam is.
  const bin = join(home, "bin");
  mkdirSync(bin);
  const calls = join(home, "gh-calls.txt");
  const body = options.body ?? `thread: ${thread}\nrole: dev-core\n`;
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      `echo "$@" >> ${JSON.stringify(calls)}`,
      `n=$(wc -l < ${JSON.stringify(calls)} | tr -d ' ')`,
      `words="${options.words.join(" ")}"`,
      'word=$(echo "$words" | cut -d" " -f"$n")',
      'case "$1 $2" in',
      "  'pr list')",
      `    printf '[{"number":251,"headRefOid":"7d097f11","body":%s,"mergeable":"%s"}]' ${JSON.stringify(
        JSON.stringify(body),
      )} "$word" ;;`,
      '  *) printf \'{"mergeable":"%s"}\' "$word" ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const state = join(repo, ".orchestrator", "notify.state");
  return {
    home,
    repo,
    root,
    mail,
    state,
    calls,
    thread,
    messages: (): readonly string[] =>
      readdirSync(join(root, thread, "messages")).filter((name) => name.endsWith(".md")),
    letter: (name: string): string => readFileSync(join(root, thread, "messages", name), "utf8"),
    run: (): { code: number; out: string } => {
      const env = { ...sandbox(configHomeInside(repo)), PATH: `${bin}:${process.env.PATH ?? ""}` };
      try {
        return {
          code: 0,
          out: execFileSync(
            TSX,
            [
              CLI,
              "notify",
              "--repo",
              repo,
              "--root",
              root,
              "--state",
              state,
              "--ref",
              "HEAD",
              "--no-fetch",
              "--write",
            ],
            { encoding: "utf8", stdio: "pipe", env },
          ),
        };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
      }
    },
  };
};

describe("the watchman of mergeability delivers a letter (thread 097, half 2)", () => {
  it("writes ONE letter into the thread of the pull request, with the turn on its role", () => {
    // Two agreeing answers, and the second one is the confirming ask the pass owes because
    // `CONFLICTING` disagrees with what an unmarked state remembers.
    const it0 = box({ words: ["CONFLICTING", "CONFLICTING", "CONFLICTING"] });
    const first = it0.run();
    const fresh = it0.messages().filter((name) => name.includes("github"));
    expect(fresh).toHaveLength(1);
    const letter = it0.letter(fresh[0] as string);
    expect(letter).toContain("from: github");
    expect(letter).toContain("waiting-on: dev-core");
    expect(letter).toContain("PR #251 no longer applies to its base");
    // The price is in the letter, not only the state — a rebase voids the round of review.
    expect(letter).toContain("guard 1");
    expect(first.out).toContain("the turn was passed to dev-core");
    // The delivery is a COMMIT AND A PUSH, not a file left in a checkout.
    expect(git(it0.mail, "status", "--porcelain")).toBe("");
    expect(git(it0.mail, "log", "--oneline", "origin/comms", "-1")).toContain("github");
    // The mark is on disk, keyed by the pull request and nothing else.
    expect(readFileSync(it0.state, "utf8")).toContain("mergeable\tpr:251");
    // And it was asked TWICE: the list, then the confirming view.
    expect(readFileSync(it0.calls, "utf8").trim().split("\n")).toHaveLength(2);

    // ONE LETTER PER BREAK, ACROSS A RESTART — a second process, the same conflict, and the
    // mark read back off the disk is the only thing that keeps it quiet.
    const second = it0.run();
    expect(it0.messages().filter((name) => name.includes("github"))).toHaveLength(1);
    expect(second.out).not.toContain("the turn was passed to dev-core");
    // And it cost ONE call, not two: the cheap word agrees with what the mark remembers.
    expect(readFileSync(it0.calls, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("says nothing on a single answer, and nothing on a merge that made everything UNKNOWN", () => {
    // The list says UNKNOWN (the state of every open pull request right after a merge), the
    // confirming ask says UNKNOWN too: no verdict, so no letter and no mark.
    const it0 = box({ words: ["UNKNOWN", "UNKNOWN"] });
    const run = it0.run();
    expect(it0.messages().filter((name) => name.includes("github"))).toHaveLength(0);
    expect(run.out).not.toContain("no longer applies");
    expect(readFileSync(it0.state, "utf8")).not.toContain("mergeable");
  });

  it("refuses out loud when the description names no role, and remembers nothing", () => {
    const it0 = box({
      words: ["CONFLICTING", "CONFLICTING"],
      body: "thread: 097-conflict-has-no-signal\n",
    });
    const run = it0.run();
    expect(it0.messages().filter((name) => name.includes("github"))).toHaveLength(0);
    expect(run.out).toContain("no 'role:' line");
    // NOTHING IS REMEMBERED — a mark here would make this break silent for as long as it lasts.
    expect(readFileSync(it0.state, "utf8")).not.toContain("mergeable");
  });
});
