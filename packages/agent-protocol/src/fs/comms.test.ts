import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parkedOnOf } from "../thread/thread.js";
import { loadThreads, renderThreadFailures, renderThreadWarnings } from "./comms.js";

const ROLES = ["dev-core", "curator", "john", "reviewer-pr"];

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

  it("a FIELD this reader cannot read costs the field, not the thread (thread 023)", () => {
    const at = root();
    migrated(at, "012-ok");
    migrated(at, "024-odd-field");
    // `claude.ai` instead of `claude-ai` — the incident of 2026-07-28. It used to take the
    // whole thread out of the mail; since 023 (`parked-on: pr:133` read by a daemon older
    // than the field) the field is dropped, the thread is read, and the drop is SAID.
    writeFileSync(
      join(at, "024-odd-field", "messages", "2026-07-28T19-51-10Z-curator.md"),
      MESSAGE.replace("expects: answer", "expects: answer\nworker: claude.ai"),
    );

    const { threads, failures, warnings } = loadThreads(at, ROLES);

    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["012-ok", "024-odd-field"]);
    expect(failures).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.id).toBe("024-odd-field");
    expect(warnings[0]?.file).toBe("messages/2026-07-28T19-51-10Z-curator.md");
    // ...and the parser's own sentence survives inside the line, not instead of it.
    expect(warnings[0]?.problem).toContain("worker: claude.ai");
    expect(renderThreadWarnings(warnings)[0]).toContain("DROPPED");

    rmSync(at, { recursive: true, force: true });
  });

  it("an EVENT park written into a file reaches the reader whole — no failure, no drop (thread 023)", () => {
    const at = root();
    migrated(at, "047-event-park");
    // The exact header of the second incident of the day (047, 2026-07-31T23:03:55Z): the
    // turn is handed to the reviewer AND the thread declares itself frozen behind the merge
    // of the PR that reviewer is judging. Both fields at once, in a file, is what the writing
    // door emits — and the layers below it were pinned one by one (the door writes `pr:127`,
    // the queue row calls it a merge) with nothing pinning the WHOLE path from the file. The
    // asymmetry that costs a night is not a layer being wrong, it is a layer being untested:
    // a park the writers consider live must arrive at the planner as a park, or the thread is
    // read as ordinary and raised, or dropped and frozen, and neither is said out loud.
    writeFileSync(
      join(at, "047-event-park", "messages", "2026-07-31T23-03-55Z-dev-core.md"),
      MESSAGE.replace("from: curator", "from: dev-core")
        .replace("waiting-on: dev-core", "waiting-on: reviewer-pr")
        .replace("expects: answer", "expects: answer\nparked-on: pr:149"),
    );

    const { threads, failures, warnings } = loadThreads(at, ROLES);

    expect(failures).toEqual([]);
    expect(warnings).toEqual([]);
    const loaded = threads.find((entry) => entry.thread.id === "047-event-park");
    if (loaded === undefined) throw new Error("the thread was not read at all");
    expect(loaded.thread.messages.at(-1)?.fields.parkedOn).toBe("pr:149");
    // ...and the same value as the planner reads it: the park of the THREAD, still frozen
    // because no notifier has said 149 back anywhere in the mail.
    expect(parkedOnOf(loaded.thread, new Set())).toBe("pr:149");
    // The merge lifts it, and from the merges of the WHOLE mail — not of this feed.
    expect(parkedOnOf(loaded.thread, new Set([149]))).toBeUndefined();

    rmSync(at, { recursive: true, force: true });
  });

  it("a message broken in the FIELDS OF THE TURN still refuses the thread, by file name", () => {
    const at = root();
    migrated(at, "012-ok");
    migrated(at, "024-broken");
    // A hole in the feed would make the turn stale-but-plausible, and the broken file is
    // typically the last one (thread 016: three threads at once, in all three the last file).
    writeFileSync(
      join(at, "024-broken", "messages", "2026-07-28T19-51-10Z-curator.md"),
      MESSAGE.replace("expects: answer", "expects: maybe"),
    );

    const { threads, failures } = loadThreads(at, ROLES);

    expect(threads.map((loaded) => loaded.thread.id)).toEqual(["012-ok"]);
    expect(failures.map((failure) => failure.id)).toEqual(["024-broken"]);
    expect(failures[0]?.problem).toContain("messages/2026-07-28T19-51-10Z-curator.md");
    expect(failures[0]?.problem).toContain("expects: maybe");

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
