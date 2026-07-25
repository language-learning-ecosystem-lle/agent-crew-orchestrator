import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadThreads, renderThreadFailures } from "./comms.js";

const ROLES = ["dev-core", "curator", "john"];

const META = "---\ntitle: Thread\nparticipants: dev-core, curator\nstatus: open\n---\n";
const MESSAGE =
  "---\nfrom: curator\ndate: 2026-07-24T13:45:12Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nBody.\n";

/** An empty mail root in a temporary directory. */
const root = (): string => mkdtempSync(join(tmpdir(), "agent-protocol-comms-"));

/** A migrated thread: `_meta.md` + one message as a file. */
const migrated = (at: string, id: string): void => {
  mkdirSync(join(at, id, "messages"), { recursive: true });
  writeFileSync(join(at, id, "_meta.md"), META);
  writeFileSync(join(at, id, "messages", "2026-07-24T13-45-12Z-curator.md"), MESSAGE);
};

/** A legacy thread: a single `_thread.md`, no messages directory. */
const legacy = (at: string, id: string): void => {
  mkdirSync(join(at, id), { recursive: true });
  writeFileSync(
    join(at, id, "_thread.md"),
    `# ${id} · Thread\n\nparticipants: dev-core, curator · status: open\n\n## msg-001 · from: curator · 2026-07-24 · expects: answer\n\nBody.\n\nwaiting-on → dev-core\n`,
  );
};

describe("loadThreads — a failure of one thread does not blind the circuit", () => {
  it("a half-migrated thread goes to failures, the rest are read", () => {
    const at = root();
    migrated(at, "012-ok");
    migrated(at, "013-ok");
    // A message file dropped into a legacy thread by hand: `messages/` is there,
    // `_meta.md` is not — exactly the incident with 009.
    legacy(at, "009-broken");
    mkdirSync(join(at, "009-broken", "messages"));
    writeFileSync(join(at, "009-broken", "messages", "2026-07-24T21-00-00Z-curator.md"), MESSAGE);

    const { threads, failures } = loadThreads(at, ROLES);

    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["012-ok", "013-ok"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.id).toBe("009-broken");

    rmSync(at, { recursive: true, force: true });
  });

  it("names the reason as a state, not as a file path", () => {
    const at = root();
    legacy(at, "009-broken");
    mkdirSync(join(at, "009-broken", "messages"));
    writeFileSync(join(at, "009-broken", "messages", "2026-07-24T21-00-00Z-curator.md"), MESSAGE);

    const { failures } = loadThreads(at, ROLES);

    expect(failures[0]?.problem).toContain("half-migrated");
    expect(failures[0]?.problem).toContain("_meta.md");
    // A legacy `_thread.md` lies next to it — the hint on what to do must be there.
    expect(failures[0]?.problem).toContain("finish migrating");

    rmSync(at, { recursive: true, force: true });
  });

  it("a broken `_meta.md` is isolated too instead of killing the walk", () => {
    const at = root();
    migrated(at, "012-ok");
    migrated(at, "013-broken");
    writeFileSync(join(at, "013-broken", "_meta.md"), "garbage without a header\n");

    const { threads, failures } = loadThreads(at, ROLES);

    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["012-ok"]);
    expect(failures.map((failure) => failure.id)).toEqual(["013-broken"]);

    rmSync(at, { recursive: true, force: true });
  });

  it("everything intact — failures is empty, threads in id order", () => {
    const at = root();
    migrated(at, "013-b");
    migrated(at, "012-a");
    legacy(at, "009-legacy");

    const { threads, failures } = loadThreads(at, ROLES);

    expect(failures).toEqual([]);
    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["009-legacy", "012-a", "013-b"]);
    expect(threads.find((loaded) => loaded.thread.id === "009-legacy")?.legacy).toBe(true);

    rmSync(at, { recursive: true, force: true });
  });

  it("an unreadable ROOT is still an exception: that is not 'part of the mail' but its absence", () => {
    expect(() => loadThreads(join(tmpdir(), "agent-protocol-no-such-directory"), ROLES)).toThrow();
  });
});

describe("renderThreadFailures", () => {
  it("one line per failure: thread id and what exactly is wrong", () => {
    const lines = renderThreadFailures([{ id: "009-mobile-front", problem: "half-migrated" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("009-mobile-front");
    expect(lines[0]).toContain("could not be read");
    expect(lines[0]).toContain("half-migrated");
  });

  it("no failures — no lines (silence is honest here: there is nothing to complain about)", () => {
    expect(renderThreadFailures([])).toEqual([]);
  });
});
