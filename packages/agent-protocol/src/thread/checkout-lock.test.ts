import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { fileMailLock, MailCheckoutBusyError, unlockedMail } from "./checkout-lock.js";

const lockPath = (): string =>
  join(mkdtempSync(join(tmpdir(), "agent-protocol-mail-lock-")), "mail.lock");

/** Time under the test's control: waiting is a decision here, not a delay. */
const clock = (steps: readonly number[]) => {
  let at = 0;
  let step = 0;
  return {
    now: () => at,
    sleep: () => {
      at += steps[Math.min(step, steps.length - 1)] ?? 1000;
      step += 1;
    },
    slept: () => step,
  };
};

describe("fileMailLock", () => {
  it("holds the checkout for the body and lets it go afterwards", () => {
    const path = lockPath();
    const lock = fileMailLock({ path, holder: "dev-core → 023", note: () => {} });

    const inside = lock.hold(() => {
      expect(existsSync(path)).toBe(true);
      const record = JSON.parse(readFileSync(path, "utf8")) as { pid: number; holder: string };
      expect(record.pid).toBe(process.pid);
      expect(record.holder).toBe("dev-core → 023");
      return "done";
    });

    expect(inside).toBe("done");
    expect(existsSync(path)).toBe(false);
  });

  it("lets go even when the body throws — a crash must not take the mail down with it", () => {
    const path = lockPath();
    const lock = fileMailLock({ path, holder: "h", note: () => {} });

    expect(() =>
      lock.hold(() => {
        throw new Error("the push was rejected");
      }),
    ).toThrow("the push was rejected");
    expect(existsSync(path)).toBe(false);
  });

  it("waits while a LIVE holder is inside, then refuses BY NAME with who and for how long", () => {
    const path = lockPath();
    // A living holder: our own pid is the one process we know is alive.
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, holder: "curator → 019", since: "2026-07-27T20:00:00Z" }),
    );
    const notes: string[] = [];
    const time = clock([1000]);
    const lock = fileMailLock({
      path,
      holder: "dev-core → 023",
      note: (line) => notes.push(line),
      waitMs: 3000,
      now: time.now,
      alive: () => true,
      sleep: time.sleep,
    });

    expect(() => lock.hold(() => "never")).toThrow(MailCheckoutBusyError);
    try {
      lock.hold(() => "never");
    } catch (error) {
      const said = (error as Error).message;
      expect(said).toContain("curator → 019");
      expect(said).toContain("nothing was written");
      expect(said).toContain(path);
    }
    // It really waited rather than refusing on sight.
    expect(time.slept()).toBeGreaterThan(0);
    expect(existsSync(path)).toBe(true);
  });

  it("frees up while we wait: the very next round walks in", () => {
    const path = lockPath();
    writeFileSync(path, JSON.stringify({ pid: 4242, holder: "curator → 019", since: "s" }));
    const time = clock([1000]);
    const lock = fileMailLock({
      path,
      holder: "dev-core → 023",
      note: () => {},
      waitMs: 60_000,
      now: time.now,
      alive: () => true,
      sleep: () => {
        time.sleep();
        // The other delivery finished between two looks.
        if (existsSync(path)) rmSync(path);
      },
    });

    expect(lock.hold(() => "in")).toBe("in");
    expect(existsSync(path)).toBe(false);
  });

  it("steals from a holder that no longer exists — LOUDLY, and does not wait for a ghost", () => {
    const path = lockPath();
    writeFileSync(
      path,
      JSON.stringify({
        pid: 999_999,
        holder: "a session that died",
        since: "2026-07-27T19:00:00Z",
      }),
    );
    const notes: string[] = [];
    const time = clock([1000]);
    const lock = fileMailLock({
      path,
      holder: "dev-core → 023",
      note: (line) => notes.push(line),
      waitMs: 1000,
      now: time.now,
      alive: () => false,
      sleep: time.sleep,
    });

    expect(lock.hold(() => "in")).toBe("in");
    expect(time.slept()).toBe(0);
    expect(notes.join("\n")).toContain("a process that is gone");
    expect(notes.join("\n")).toContain("999999");
  });

  it("does not delete a lock that was taken over while we held it", () => {
    const path = lockPath();
    const notes: string[] = [];
    const lock = fileMailLock({ path, holder: "ours", note: (line) => notes.push(line) });

    lock.hold(() => {
      // Somebody decided we were dead and put their own record in.
      writeFileSync(path, JSON.stringify({ pid: 7, holder: "theirs", since: "s" }));
    });

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8")).holder).toBe("theirs");
    expect(notes.join("\n")).toContain("no longer ours");
  });

  it("an unreadable record is waited for, never read as a free checkout", () => {
    const path = lockPath();
    writeFileSync(path, "{half-writ");
    const time = clock([1000]);
    const lock = fileMailLock({
      path,
      holder: "ours",
      note: () => {},
      waitMs: 2000,
      now: time.now,
      alive: () => false,
      sleep: time.sleep,
    });

    expect(() => lock.hold(() => "never")).toThrow(/unreadable/);
  });
});

describe("unlockedMail", () => {
  it("is the caller's explicit 'there is nobody to race here'", () => {
    expect(unlockedMail.hold(() => 1)).toBe(1);
  });
});
