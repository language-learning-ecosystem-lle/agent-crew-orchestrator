import { describe, expect, it } from "vitest";

import type { Message } from "./message.js";
import { parseMessageFile } from "./message.js";
import { migrateLegacyThread, verifyMigration } from "./migrate.js";
import { renderThread, type ThreadMeta } from "./thread.js";

// Regression from 012 (msg-069). The merge #27 notifier stamped its message with
// the date 2026-07-23 but appended it to the feed AFTER the messages of
// 2026-07-24 (the job started before UTC midnight, the retry loop pushed after).
// The date is non-monotonic with the thread order. A migrated file name leads with
// the date — a flat sort of names would put github(002) first and reorder the
// feed. Order is held by `seq` (position), and the migration must be ACCEPTED
// rather than fail the sorting round-trip.
const roles = ["curator", "github"];

const meta: ThreadMeta = {
  title: "012-x · thread",
  participants: ["curator", "github"],
  status: "open",
};

// The original is built by the renderer — the format is guaranteed by the same
// code the migration reads.
const messages: Message[] = [
  {
    fields: { msg: 1, from: "curator", date: "2026-07-24", expects: "answer" },
    text: "First, dated the 24th.",
  },
  {
    fields: { msg: 2, from: "github", date: "2026-07-23", expects: "none" },
    text: "Later in the feed, dated the 23rd.",
  },
];
const original = renderThread(meta, messages);

describe("migrateLegacyThread + verifyMigration (non-monotonic date)", () => {
  it("a flat sort of names would reorder the feed — hence the name is NOT the ordering key", () => {
    const migration = migrateLegacyThread("012-x", original, roles);
    const names = migration.files
      .filter((f) => f.path.startsWith("messages/"))
      .map((f) => f.path)
      .sort();

    // github(002) dated 07-23 sorts BY NAME before curator(001) dated 07-24:
    expect(names[0]).toContain("002-github");
  });

  it("the guard accepts the migration: ordering by seq reproduces the original byte for byte", () => {
    const migration = migrateLegacyThread("012-x", original, roles);
    expect(verifyMigration(migration, original)).toBeUndefined();
  });
});

describe("provenance of a thread moved out of _thread.md", () => {
  it("stamps every migrated message 'worker: unknown' — a section carries no provenance at all", () => {
    // The threads still in the legacy form (009, 010) move AFTER version 2 lands, so
    // a file written by that migration with no `worker` would be indistinguishable
    // from one whose writer failed to record it. Silence must not mean two things.
    const migration = migrateLegacyThread("012-x", original, roles);

    const messages = migration.files.filter((file) => file.path.startsWith("messages/"));
    expect(messages.length).toBeGreaterThan(0);
    for (const file of messages) {
      expect(parseMessageFile(file.content).fields.worker).toBe("unknown");
    }
  });

  it("and the byte-exact guard still holds — the stamp does not reach the assembled feed", () => {
    const migration = migrateLegacyThread("012-x", original, roles);

    expect(verifyMigration(migration, original)).toBeUndefined();
  });
});
