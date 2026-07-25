/**
 * The migration 1 → 2 (R7). Its only real defence is the PROOF it carries, so the
 * tests are about the proof rather than about the happy path.
 *
 * Two of the fixtures are REAL FILES from the mail of this repository, copied byte
 * for byte (the README requires a live fixture for a step that rewrites committed
 * messages, and for a good reason: every surprise of the previous migration came
 * from the live feed). They are not interchangeable — one is a MIGRATED message
 * (`msg`/`seq`, a date without a time) and the other a NEW one whose file ends in
 * TWO newlines, which is exactly the quirk that rules a re-render out: 120 of the
 * 327 live message files carry that extra byte.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseMessageFile } from "../thread/message.js";
import { planMigration } from "./migrate.js";
import type { MigrationContext } from "./step.js";
import { MigrationRefusedError } from "./step.js";
import { insertWorkerLine, isMessagePath, MESSAGE_PROVENANCE_STEP } from "./v2-provenance.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const MIGRATED = fixture("migrated-2026-07-22-012-github.md");
const NEW = fixture("new-2026-07-25T15-25-03Z-github.md");

const MAIL = "/repo/.worktrees/comms/agent-comms";
const CONFIG_PATH = "/repo/agent-protocol.json";

const contextWith = (files: Record<string, string>): MigrationContext => ({
  config: { protocolVersion: 1 },
  configPath: CONFIG_PATH,
  mailRoot: MAIL,
  read: (path) => files[path] ?? "",
  list: () => Object.keys(files),
});

describe("insertWorkerLine", () => {
  it("puts 'worker: unknown' after 'from:' and changes NOTHING else — on a real migrated message", () => {
    const migrated = insertWorkerLine(MIGRATED, "m.md");

    expect(migrated.split("\n").slice(0, 5)).toEqual([
      "---",
      "msg: 012",
      "seq: 012",
      "from: github",
      "worker: unknown",
    ]);
    // The proof, stated the same way the step states it: strike the line out again.
    const back = migrated.split("\n");
    back.splice(4, 1);
    expect(back.join("\n")).toBe(MIGRATED);
  });

  it("keeps the trailing bytes a live file happens to have — the reason it is not a re-render", () => {
    // This real file ends in TWO newlines (a writer that predates the CLI). A step
    // built on parse → render would "tidy" it, which is a change nobody asked for
    // in a file nobody may edit.
    expect(NEW.endsWith("\n\n")).toBe(true);

    const migrated = insertWorkerLine(NEW, "n.md");

    expect(migrated.endsWith("\n\n")).toBe(true);
    expect(migrated.replace("worker: unknown\n", "")).toBe(NEW);
  });

  it("preserves the body and the authorship — boundary (a) as a checked fact", () => {
    const before = parseMessageFile(MIGRATED);
    const after = parseMessageFile(insertWorkerLine(MIGRATED, "m.md"));

    expect(after.text).toBe(before.text);
    expect(after.fields.from).toBe(before.fields.from);
    expect(after.fields.date).toBe(before.fields.date);
    expect(after.fields.msg).toBe(before.fields.msg);
    expect(after.fields.seq).toBe(before.fields.seq);
    expect(after.fields.expects).toBe(before.fields.expects);
    expect(after.fields.waitingOn).toEqual(before.fields.waitingOn);
    expect(after.fields.worker).toBe("unknown");
  });

  it("refuses a file it cannot place the field in, instead of guessing", () => {
    expect(() => insertWorkerLine("no front matter here\n", "x.md")).toThrow(MigrationRefusedError);
    expect(() => insertWorkerLine("---\nfrom: a\ndate: 2026-07-22\n", "y.md")).toThrow(
      /header is not closed/,
    );
    expect(() =>
      insertWorkerLine("---\ndate: 2026-07-22\nexpects: none\n---\n\nbody\n", "z.md"),
    ).toThrow(/no 'from:' line/);
  });
});

describe("isMessagePath", () => {
  it("takes message files and leaves the derived and the meta alone", () => {
    expect(isMessagePath(`${MAIL}/016-x/messages/2026-07-25T10-00-00Z-curator.md`)).toBe(true);
    expect(isMessagePath(`${MAIL}/016-x/_thread.md`)).toBe(false);
    expect(isMessagePath(`${MAIL}/016-x/_meta.md`)).toBe(false);
    expect(isMessagePath(`${MAIL}/INDEX.md`)).toBe(false);
    expect(isMessagePath(`${MAIL}/016-x/messages/notes.txt`)).toBe(false);
  });
});

describe("the step in the chain", () => {
  const files = {
    [`${MAIL}/003-x/messages/2026-07-22-012-github.md`]: MIGRATED,
    [`${MAIL}/016-y/messages/2026-07-25T15-25-03Z-github.md`]: NEW,
    [`${MAIL}/016-y/_thread.md`]: "# derived\n",
    [`${MAIL}/INDEX.md`]: "# index\n",
  };

  it("stamps every message and touches neither the derived files nor the index", () => {
    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith(files),
      steps: [MESSAGE_PROVENANCE_STEP],
    });

    const written = plan.writes.map((file) => file.path);
    expect(written).toEqual([
      `${MAIL}/003-x/messages/2026-07-22-012-github.md`,
      `${MAIL}/016-y/messages/2026-07-25T15-25-03Z-github.md`,
      CONFIG_PATH,
    ]);
    // Property 1 of the frame: the runner writes the version, the step never does.
    expect(JSON.parse(plan.writes.at(-1)?.content ?? "{}")).toEqual({ protocolVersion: 2 });
  });

  it("says in the plan how many messages it stamped — the number is read before --write", () => {
    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith(files),
      steps: [MESSAGE_PROVENANCE_STEP],
    });

    expect(plan.steps[0]?.notes[0]).toContain("2");
  });

  it("is idempotent by fact: a second run over the stamped mail writes no message", () => {
    // Not by a marker anywhere — the step asks each file whether it already states
    // its provenance. Which also means a thread migrated later (009, 010) arrives
    // with its own `worker: unknown` and is left alone.
    const stamped = Object.fromEntries(
      Object.entries(files).map(([path, raw]) => [
        path,
        isMessagePath(path) ? insertWorkerLine(raw, path) : raw,
      ]),
    );

    const plan = planMigration({
      declared: 1,
      target: 2,
      context: contextWith(stamped),
      steps: [MESSAGE_PROVENANCE_STEP],
    });

    expect(plan.writes.map((file) => file.path)).toEqual([CONFIG_PATH]);
  });

  it("aborts the whole chain when one file cannot be proven — nothing is written", () => {
    const broken = { ...files, [`${MAIL}/016-y/messages/hand-written.md`]: "not a message at all" };

    expect(() =>
      planMigration({
        declared: 1,
        target: 2,
        context: contextWith(broken),
        steps: [MESSAGE_PROVENANCE_STEP],
      }),
    ).toThrow(MigrationRefusedError);
  });
});
