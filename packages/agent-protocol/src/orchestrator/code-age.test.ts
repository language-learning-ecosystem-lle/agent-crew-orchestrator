/**
 * THE REPRO OF 2026-08-03 (023.2): a process whose modules were loaded from one commit
 * while the ref it judges by has moved on. The incident is not hypothetical — the daemon
 * of that day ran code from 05:13Z against a lift that landed at 11:15Z, and the only
 * outward sign was that nothing happened.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CODE_DRIFT_OVERDUE_MINUTES,
  type CodeVintage,
  codeAgeView,
  codeDriftOverdue,
  codeReading,
  describeCodeDrift,
  describeCodeVintage,
  describeDriftSize,
  describeUnpublishedCode,
  describeUnreadableCodeAge,
  driftMinutes,
  isVintage,
  measureCodeDrift,
  parseCodeVintage,
  parseDriftStandoff,
  readCodeVintage,
  renderCodeVintage,
  renderDriftStandoff,
} from "./code-age.js";

const vintage = (partial: Partial<CodeVintage> = {}): CodeVintage => ({
  sha: "a830761a1c0ffee0000000000000000000000000",
  checkout: "/home/lle/projects/language-learning-ecosystem",
  startedAt: "2026-08-03T05:13:11Z",
  pid: 710030,
  ...partial,
});

const git = (root: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** A repository with two commits and a `ref/loaded` split, for the real-git half. */
const repoWithTwoCommits = (): { readonly root: string; readonly first: string } => {
  const root = mkdtempSync(join(tmpdir(), "agent-protocol-codeage-"));
  git(root, ["init", "--quiet", "--initial-branch", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  writeFileSync(join(root, "a.txt"), "one\n");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "one"]);
  const first = git(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "a.txt"), "two\n");
  git(root, ["commit", "--quiet", "-a", "-m", "two"]);
  return { root, first };
};

describe("codeReading — the verdict", () => {
  it("the same SHA is a MATCH: no line, because good news every tick is noise", () => {
    const loaded = vintage();
    expect(codeReading({ vintage: loaded, ref: "origin/main", refSha: loaded.sha })).toEqual({
      kind: "match",
    });
  });

  it("a different SHA is a DRIFT carrying both SHAs and the distance", () => {
    const reading = codeReading({
      vintage: vintage(),
      ref: "origin/main",
      refSha: "951b7551ffffffffffffffffffffffffffffffff",
      behind: 13,
    });
    expect(reading.kind).toBe("drift");
    if (reading.kind !== "drift") return;
    expect(reading.drift.refSha).toBe("951b7551ffffffffffffffffffffffffffffffff");
    expect(reading.drift.behind).toBe(13);
  });

  it("an uncountable distance still drifts — the two SHAs are the fact, the count is a convenience", () => {
    const reading = codeReading({
      vintage: vintage(),
      ref: "origin/main",
      refSha: "951b7551ffffffffffffffffffffffffffffffff",
    });
    expect(reading.kind).toBe("drift");
    if (reading.kind !== "drift") return;
    expect(reading.drift.behind).toBeUndefined();
  });
});

describe("describeCodeDrift — facts, not advice (curator, 023.2)", () => {
  const line = describeCodeDrift(
    {
      vintage: vintage(),
      ref: "origin/main",
      refSha: "951b7551ffffffffffffffffffffffffffffffff",
      behind: 13,
    },
    new Date("2026-08-03T13:13:11Z"),
  );

  it("names the four facts: loaded SHA, ref SHA, the distance and since when it is up", () => {
    expect(line).toContain("a830761a");
    expect(line).toContain("origin/main");
    expect(line).toContain("951b7551");
    expect(line).toContain("13 commit(s) behind");
    expect(line).toContain("2026-08-03T05:13:11Z");
    expect(line).toContain("8h");
  });

  it("carries no command to run — a line that ends in advice is a line that gets skimmed", () => {
    expect(line).not.toContain("restart");
    expect(line).not.toContain("--pull");
  });

  it("the startup line says what was loaded, whether or not anything has moved", () => {
    expect(describeCodeVintage(vintage())).toContain("a830761a");
    expect(describeCodeVintage(vintage())).toContain("2026-08-03T05:13:11Z");
  });
});

describe("measureCodeDrift — against the ref ON DISK, no network", () => {
  it("code at A, ref at B: a drift naming the distance (the incident of 2026-08-03)", () => {
    const { root, first } = repoWithTwoCommits();
    const reading = measureCodeDrift({
      vintage: vintage({ sha: first, checkout: root }),
      ref: "main",
    });
    expect(reading.kind).toBe("drift");
    if (reading.kind !== "drift") return;
    expect(reading.drift.behind).toBe(1);
    expect(reading.drift.refSha).not.toBe(first);
  });

  it("dates the drift by the OLDEST commit the code lacks (thread 044)", () => {
    const { root, first } = repoWithTwoCommits();
    // A third commit on top: the box lacks two, and the clock starts at the FIRST of
    // them — the moment it fell behind, not the moment of the newest merge.
    writeFileSync(join(root, "a.txt"), "three\n");
    git(root, ["commit", "--quiet", "-a", "-m", "three"]);
    const reading = measureCodeDrift({
      vintage: vintage({ sha: first, checkout: root }),
      ref: "main",
    });
    expect(reading.kind).toBe("drift");
    if (reading.kind !== "drift") return;
    expect(reading.drift.behind).toBe(2);
    const oldestMissing = git(root, ["log", "--format=%cI", `${first}..main`])
      .split("\n")
      .map((line) => line.trim())
      .at(-1);
    expect(reading.drift.since).toBe(oldestMissing);
  });

  it("code at the ref: a MATCH, and nothing is printed anywhere", () => {
    const { root } = repoWithTwoCommits();
    const reading = measureCodeDrift({
      vintage: vintage({ sha: git(root, ["rev-parse", "HEAD"]), checkout: root }),
      ref: "main",
    });
    expect(reading).toEqual({ kind: "match" });
  });

  it("a ref that does not resolve is UNKNOWN and named — never a silent match", () => {
    const { root, first } = repoWithTwoCommits();
    const reading = measureCodeDrift({
      vintage: vintage({ sha: first, checkout: root }),
      ref: "origin/does-not-exist",
    });
    expect(reading.kind).toBe("unknown");
  });
});

/**
 * THREAD 044 — THE DRIFT IS A MEASURED QUANTITY AND NOT A STATE. Uptime was the only clock
 * the module had, and it answers the wrong question in the one direction that hides the
 * fault: a daemon raised five minutes ago over six-hour-old code reads as young.
 */
describe("how long the box has been behind (thread 044)", () => {
  const drifted = {
    vintage: vintage(),
    ref: "origin/main",
    refSha: "951b7551ffffffffffffffffffffffffffffffff",
    behind: 3,
    since: "2026-08-29T03:24:02Z",
  };
  const now = new Date("2026-08-29T09:24:02Z");

  it("counts from the OLDEST commit the code lacks, not from the process's start", () => {
    // The process came up at 05:13Z and is six hours behind — the two numbers disagree,
    // and the drift's own clock is the one the threshold is judged on.
    expect(driftMinutes(drifted, now)).toBe(360);
  });

  it("an undated drift has no age at all — a zero would read as 'it just happened'", () => {
    const { since, ...undated } = drifted;
    expect(since).toBeDefined();
    expect(driftMinutes(undated, now)).toBeUndefined();
    expect(codeDriftOverdue(undated, now)).toBe(false);
  });

  it("the band is crossed at the threshold and not before it", () => {
    const at = (minutes: number) => new Date(new Date(drifted.since).getTime() + minutes * 60000);
    expect(codeDriftOverdue(drifted, at(CODE_DRIFT_OVERDUE_MINUTES - 1))).toBe(false);
    expect(codeDriftOverdue(drifted, at(CODE_DRIFT_OVERDUE_MINUTES))).toBe(true);
  });

  it("says the size in both units, and degrades on each half on its own", () => {
    expect(describeDriftSize(drifted, now)).toContain("3 commit(s) behind");
    expect(describeDriftSize(drifted, now)).toContain("6h");
    expect(describeDriftSize({ since: drifted.since }, now)).toContain("distance uncountable");
    expect(describeDriftSize({ behind: 3 }, now)).toContain("unreadable date");
  });

  it("the daemon's own line now carries the drift's age BESIDE its uptime", () => {
    const line = describeCodeDrift(drifted, now);
    // Up for four hours, behind for six: two clocks, both named, neither mistakable for
    // the other.
    expect(line).toContain("drifting for 6h");
    expect(line).toContain("up since 2026-08-03T05:13:11Z");
  });
});

describe("the standoff on disk — what the courier reads (thread 044)", () => {
  const standoff = {
    refSha: "951b7551ffffffffffffffffffffffffffffffff",
    sha: "a830761affffffffffffffffffffffffffffffff",
    ref: "origin/main",
    behind: 3,
    since: "2026-08-29T03:24:02Z",
    why: "no self-restart while sessions are live (curator)",
    at: "2026-08-29T09:24:02Z",
  };

  it("round-trips, so the process that measures and the process that tells agree", () => {
    expect(parseDriftStandoff(renderDriftStandoff(standoff))).toEqual(standoff);
  });

  it("a record missing the reason is NOT half-read — the reason is why it exists", () => {
    const { why, ...half } = standoff;
    expect(why).toBeDefined();
    expect(parseDriftStandoff(JSON.stringify(half))).toBeUndefined();
    expect(parseDriftStandoff("")).toBeUndefined();
    expect(parseDriftStandoff("{not json")).toBeUndefined();
  });

  it("is judged by the SAME clock as a live reading — one threshold, two readers", () => {
    expect(codeDriftOverdue(standoff, new Date("2026-08-29T09:24:02Z"))).toBe(true);
    expect(codeDriftOverdue(standoff, new Date("2026-08-29T04:24:02Z"))).toBe(false);
  });
});

describe("readCodeVintage — what this process is running", () => {
  it("reads HEAD and the top level of the checkout the module lies in", () => {
    const { root } = repoWithTwoCommits();
    const read = readCodeVintage({
      dir: root,
      startedAt: new Date("2026-08-03T05:13:11.500Z"),
      pid: 710030,
    });
    expect(isVintage(read)).toBe(true);
    if (!isVintage(read)) return;
    expect(read.sha).toBe(git(root, ["rev-parse", "HEAD"]));
    // Seconds, like every other timestamp of the circuit — a frame is read, not parsed.
    expect(read.startedAt).toBe("2026-08-03T05:13:11Z");
  });

  it("a directory that is no repository is REPORTED, not thrown over", () => {
    const read = readCodeVintage({ dir: tmpdir(), startedAt: new Date(), pid: process.pid });
    // `/tmp` may or may not sit inside somebody's repository; either answer is legitimate,
    // and the one thing that must never happen is an exception out of a diagnostic.
    expect(typeof read).toBe("object");
  });
});

describe("the vintage on disk — the daemon publishes, the frame reads", () => {
  it("survives a round trip", () => {
    expect(parseCodeVintage(renderCodeVintage(vintage()))).toEqual(vintage());
  });

  it("junk and emptiness read as ABSENT, so a broken file costs a line and not a frame", () => {
    expect(parseCodeVintage("")).toBeUndefined();
    expect(parseCodeVintage("{oh dear")).toBeUndefined();
    expect(parseCodeVintage(JSON.stringify({ sha: "abc" }))).toBeUndefined();
  });

  it("a vintage without its owner is ABSENT: an unsigned file cannot be checked against a pid", () => {
    const { pid, ...unsigned } = vintage();
    expect(parseCodeVintage(JSON.stringify(unsigned))).toBeUndefined();
    expect(pid).toBe(710030);
  });
});

/**
 * WHOSE VINTAGE THE FRAME IS ALLOWED TO BELIEVE. The file outlives its writer, and the
 * dangerous direction is not a false alarm but a false silence: a daemon raised from a
 * checkout too old to publish anything leaves the newer predecessor's file behind, and a
 * reader trusting it compares the ref against code nobody is running — finding a MATCH
 * and saying nothing. That is the silence of 2026-08-03 wearing this feature's badge.
 */
describe("codeAgeView — the reader's rule", () => {
  const drifting = (v: CodeVintage) =>
    codeReading({ vintage: v, ref: "origin/main", refSha: "951b7551ff", behind: 13 });

  it("no daemon: no line at all — the circuit section already says nobody is up", () => {
    expect(
      codeAgeView({ daemonPid: undefined, published: vintage(), measure: drifting }),
    ).toBeUndefined();
  });

  it("the live daemon's own vintage, behind the ref: the drift", () => {
    expect(codeAgeView({ daemonPid: 710030, published: vintage(), measure: drifting })).toEqual({
      kind: "drift",
      drift: expect.objectContaining({ behind: 13 }),
    });
  });

  it("the live daemon's own vintage AT the ref: silence, good news is not news", () => {
    expect(
      codeAgeView({
        daemonPid: 710030,
        published: vintage(),
        measure: (v) => codeReading({ vintage: v, ref: "origin/main", refSha: v.sha }),
      }),
    ).toBeUndefined();
  });

  it("A PREDECESSOR'S vintage is NOT the live daemon's — the repro of the false silence", () => {
    // The stale file is CURRENT (its sha is the ref): trusted, it would render silence
    // about a live daemon whose code nobody has measured.
    const stale = vintage({ pid: 710030, sha: "951b7551ff" });
    expect(
      codeAgeView({
        daemonPid: 3295463,
        published: stale,
        measure: (v) => codeReading({ vintage: v, ref: "origin/main", refSha: "951b7551ff" }),
      }),
    ).toEqual({ kind: "unpublished", pid: 3295463 });
  });

  it("a live daemon with no file at all reads the same way, and the line names the pid", () => {
    const view = codeAgeView({ daemonPid: 3295463, published: undefined, measure: drifting });
    expect(view).toEqual({ kind: "unpublished", pid: 3295463 });
    expect(describeUnpublishedCode(3295463)).toContain("3295463");
    // Facts, not advice — the same rule the drift line obeys (curator, 023.2).
    expect(describeUnpublishedCode(3295463)).not.toContain("restart");
  });

  /**
   * THE REVIEWER'S FINDING ON #190, and it is the module's own class one layer lower: a
   * reading that could not be taken (`kind: "unknown"` — an unresolvable ref, a checkout
   * that was never fetched, a typo in `--ref`) used to fold into the same `undefined` as
   * a match, so the frame drew SILENCE over a measurement that never happened while the
   * daemon's stream was naming the fault out loud. Not knowing is not good news.
   */
  it("a reading that could not be taken is NAMED, not folded into the silence of a match", () => {
    expect(
      codeAgeView({
        daemonPid: 710030,
        published: vintage(),
        measure: () => ({
          kind: "unknown",
          problem: "fatal: ambiguous argument 'origin/main^{commit}': unknown revision",
        }),
      }),
    ).toEqual({
      kind: "unreadable",
      problem: "fatal: ambiguous argument 'origin/main^{commit}': unknown revision",
    });
  });

  it("its sentence is ONE line and carries git's own words, with no advice in them", () => {
    const said = describeUnreadableCodeAge("fatal: not a git repository\n\nUse --help\n");
    expect(said).toBe(
      "the age of the loaded code is unreadable: fatal: not a git repository Use --help",
    );
    // A frame row is a row: a multi-line error pasted in breaks the picture it explains.
    expect(said).not.toContain("\n");
    expect(said).not.toContain("restart");
  });
});
