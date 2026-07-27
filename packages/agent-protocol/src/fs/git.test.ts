import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkImmutable } from "../thread/check.js";
import { mailCheckoutFreshness, messagesAtRef } from "./git.js";

const git = (repo: string, ...args: string[]): void => {
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { encoding: "utf8" },
  );
};

/** A repository with one message in a thread, committed once. */
const repoWithMessage = (): { root: string; file: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-git-"));
  const root = join(repo, "agent-comms");
  const file = join(root, "012-x", "messages", "2026-07-23T13-45-12Z-dev-core.md");

  mkdirSync(join(root, "012-x", "messages"), { recursive: true });
  writeFileSync(
    file,
    "---\nfrom: dev-core\ndate: 2026-07-23T13:45:12Z\nexpects: none\n---\n\nWas.\n",
  );

  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first message");

  return { root, file };
};

describe("messagesAtRef", () => {
  it("returns message contents as of a ref, keyed by path relative to the mail root", () => {
    const { root } = repoWithMessage();

    const files = messagesAtRef(root, "HEAD");

    expect([...files.keys()]).toEqual(["012-x/messages/2026-07-23T13-45-12Z-dev-core.md"]);
    expect(files.values().next().value).toContain("Was.");
  });

  it("together with checkImmutable catches a retroactive edit", () => {
    // This pairing is what the git layer exists for: disk only holds "now", and
    // without a point in history the question "was it edited after the fact" makes
    // no sense.
    const { root, file } = repoWithMessage();
    const previous = messagesAtRef(root, "HEAD");

    writeFileSync(file, readFileSync(file, "utf8").replace("Was.", "Became."));
    const current = new Map(
      [...previous.keys()].map((key) => [key, readFileSync(join(root, key), "utf8")]),
    );

    expect(checkImmutable(previous, current).map((issue) => issue.message)).toEqual([
      "message file changed after the commit — a retroactive edit",
    ]);
  });

  it("fails loudly on a non-existent ref instead of returning an empty map", () => {
    // An empty map would mean "nothing changed" — the check would turn into its
    // own opposite exactly where it is needed.
    const { root } = repoWithMessage();

    expect(() => messagesAtRef(root, "no-such-ref")).toThrow(/git/);
  });
});

/** An origin holding the mail branch, plus a clone of it — the shape the observer probes. */
const originAndCheckout = (branch: string): { origin: string; checkout: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-mail-"));
  const origin = join(base, "origin");
  const checkout = join(base, "checkout");

  mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q", "-b", branch);
  writeFileSync(join(origin, "first.md"), "first\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "first");

  execFileSync("git", ["clone", "-q", origin, checkout], { encoding: "utf8" });
  return { origin, checkout };
};

/** One more commit on the origin — mail that the checkout does not have yet. */
const commitOnOrigin = (origin: string, name: string): void => {
  writeFileSync(join(origin, name), `${name}\n`);
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", name);
};

describe("mailCheckoutFreshness", () => {
  // This is the collector, not the renderer: the frame's staleness mark is only worth
  // anything if the two facts under it are obtained from a REAL checkout. Hence a git
  // repository per case rather than a hand-made object.
  const BRANCH = "comms";

  it("marks a fetch that did not land: FETCH_HEAD is fresh and the tree is behind", () => {
    // The exact case correction 5 exists for. The ff-merge in `mailCheckoutState` runs
    // under try/catch, so a pull can leave the tree arbitrarily old while the timestamp
    // says "just now" — one fact alone would call this fresh, and lie.
    const { origin, checkout } = originAndCheckout(BRANCH);
    commitOnOrigin(origin, "second.md");
    commitOnOrigin(origin, "third.md");
    git(checkout, "fetch", "-q", "origin"); // fetched — and deliberately NOT merged

    const freshness = mailCheckoutFreshness(checkout, BRANCH);

    expect(freshness.behind).toBe(2);
    expect(freshness.branch).toBe(BRANCH);
    expect(freshness.problem).toBeUndefined();
    expect(freshness.fetchedAt).toBeInstanceOf(Date);
    expect(Date.now() - (freshness.fetchedAt as Date).getTime()).toBeLessThan(60_000);
  });

  it("reads and only reads: it neither fetches nor fast-forwards the checkout", () => {
    // A watcher forgotten in a tmux pane must not move mail under a live daemon. What
    // that means concretely: the same probe run twice leaves both the tree and the
    // fetch timestamp exactly where they were.
    const { origin, checkout } = originAndCheckout(BRANCH);
    git(checkout, "fetch", "-q", "origin");
    const fetchedBefore = mailCheckoutFreshness(checkout, BRANCH).fetchedAt;
    const headBefore = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
      encoding: "utf8",
    });
    commitOnOrigin(origin, "second.md");

    const after = mailCheckoutFreshness(checkout, BRANCH);

    // The new origin commit is invisible without a fetch — the probe did not make one.
    expect(after.behind).toBe(0);
    expect(after.fetchedAt?.getTime()).toBe(fetchedBefore?.getTime());
    expect(execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" })).toBe(
      headBefore,
    );
  });

  it("a checkout sitting on someone else's branch is REPORTED, not repaired", () => {
    // `mailCheckoutState` does not even attempt the ff-merge here, so this is precisely
    // where a fresh timestamp goes with an arbitrarily old tree. The observer names the
    // branch it actually found and keeps counting.
    const { origin, checkout } = originAndCheckout(BRANCH);
    commitOnOrigin(origin, "second.md");
    git(checkout, "fetch", "-q", "origin");
    git(checkout, "checkout", "-q", "-b", "someone-elses-work");

    const freshness = mailCheckoutFreshness(checkout, BRANCH);

    expect(freshness.branch).toBe("someone-elses-work");
    expect(freshness.behind).toBe(1);
    expect(freshness.problem).toBeUndefined();
  });

  it("without origin/<branch> it names the problem instead of throwing at the watcher", () => {
    // Never fetched, or a different remote: an honest "the age is unknown" keeps the
    // frame drawing, whereas an exception would take the whole panel down with it.
    const { checkout } = originAndCheckout(BRANCH);

    const freshness = mailCheckoutFreshness(checkout, "no-such-branch");

    expect(freshness.behind).toBeUndefined();
    expect(freshness.problem).toMatch(/git/);
    // The branch is still named: it was read before the count failed, and half a fact
    // is better than none for someone who has to decide what to do about the checkout.
    expect(freshness.branch).toBe(BRANCH);
  });

  it("a checkout that is not a repository at all comes back as a problem", () => {
    const outside = mkdtempSync(join(tmpdir(), "agent-protocol-not-a-repo-"));

    const freshness = mailCheckoutFreshness(outside, BRANCH);

    expect(freshness.problem).toMatch(/git/);
    expect(freshness.fetchedAt).toBeUndefined();
    expect(freshness.behind).toBeUndefined();
  });
});
