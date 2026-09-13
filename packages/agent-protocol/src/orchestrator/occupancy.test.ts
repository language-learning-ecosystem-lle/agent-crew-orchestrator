/**
 * The conditions of acceptance for the DAY REPORT (thread 042, john's decision 2026-08-30
 * ~13:10Z, point 3): the box prints the free share beside the occupancy share, and it prints
 * them by ONE arithmetic — the courier's.
 *
 * The stamps are the live ones the report was ordered on (`curator×051` and `curator×052`, the
 * daemon epoch `2026-08-30T08:32:17Z`) rather than round numbers, for the reason #147 was written
 * for: arithmetic that breaks on a scale smaller than a month passes every fixture built out of
 * whole hours.
 */

import { describe, expect, it } from "vitest";
import { freeTailMinutes, unacceptedTurns } from "../notify/notify.js";
import type { OrchestratorEvent } from "./journal.js";
import { foldDay, leaseSpans, renderDay } from "./occupancy.js";

const acquired = (ts: string, role: string, thread: string): OrchestratorEvent =>
  ({ kind: "lease-acquired", ts, role, thread, deadline: ts }) as OrchestratorEvent;

const released = (ts: string, role: string, thread: string): OrchestratorEvent =>
  ({ kind: "lease-released", ts, role, thread, reason: "completed" }) as OrchestratorEvent;

/** One session of a role, opened and closed. */
const session = (
  from: string,
  to: string,
  role: string,
  thread = "052-day-report",
): OrchestratorEvent[] => [acquired(from, role, thread), released(to, role, thread)];

describe("the day report — both shares out of what is already on the box", () => {
  it("names the occupancy share of every role against one window, and where the window starts", () => {
    // 08:32:17Z…09:32:17Z is sixty minutes; `curator` holds forty-two of them over two
    // sessions, `dev-core` fifty-four over one.
    const events = [
      ...session("2026-08-30T08:32:17Z", "2026-08-30T09:00:00Z", "curator"),
      ...session("2026-08-30T09:10:00Z", "2026-08-30T09:24:17Z", "curator"),
      ...session("2026-08-30T08:38:17Z", "2026-08-30T09:32:17Z", "dev-core"),
    ];
    const report = foldDay({ events, turns: [], now: new Date("2026-08-30T09:32:17Z") });

    expect(report.windowMinutes).toBeCloseTo(60, 6);
    expect(report.from).toBe("2026-08-30T08:32:17Z");
    // The left edge is not left to the reader's head: it says the journal gave it, and why
    // that is the daemon's clock rather than the merge's.
    expect(report.windowSource).toContain("earliest event in the journal");
    expect(report.roles.map((row) => row.role)).toEqual(["dev-core", "curator"]);
    const curator = report.roles.find((row) => row.role === "curator");
    const dev = report.roles.find((row) => row.role === "dev-core");
    expect(curator?.busyMinutes).toBeCloseTo(27.72 + 14.28, 6);
    expect(curator?.share).toBeCloseTo(42 / 60, 6);
    expect(curator?.sessions).toBe(2);
    expect(dev?.share).toBeCloseTo(54 / 60, 6);
    expect(renderDay(report).some((line) => line.includes("role curator  busy 70 %"))).toBe(true);
  });

  it("says the flag gave the window when it did, and clips a lease that began before it", () => {
    const events = session("2026-08-30T08:32:17Z", "2026-08-30T09:32:17Z", "dev-core");
    const report = foldDay({
      events,
      turns: [],
      since: "2026-08-30T09:02:17Z",
      now: new Date("2026-08-30T09:32:17Z"),
    });
    expect(report.windowSource).toContain("--since");
    expect(report.windowMinutes).toBeCloseTo(30, 6);
    // The half of the session that fell outside the window is not counted, so the share is
    // 100 % of thirty minutes and not 200 %.
    expect(report.roles[0]?.busyMinutes).toBeCloseTo(30, 6);
    expect(report.roles[0]?.share).toBeCloseTo(1, 6);
  });

  it("prints the whole standing time AND the free tail, and the tail is zero under a park", () => {
    // `curator×051` as it was measured by hand on 2026-08-30: 30.4 minutes of standing, 12.9
    // of them free once the role's own leases are subtracted, and NOTHING free once the park
    // over the thread is — the pair stood behind `run:126` for the whole of it.
    const since = "2026-08-30T09:29:00Z";
    const now = new Date("2026-08-30T09:59:24Z");
    const events = session("2026-08-30T09:29:00Z", "2026-08-30T09:46:30Z", "curator", "026-other");
    const parks = [{ thread: "051-merge-ready", from: "2026-08-30T09:29:00Z" }];
    const turns = [{ role: "curator", thread: "051-merge-ready", since }];

    const withoutPark = foldDay({ events, turns, now });
    expect(withoutPark.standing[0]?.standingMinutes).toBeCloseTo(30.4, 1);
    expect(withoutPark.standing[0]?.freeMinutes).toBeCloseTo(12.9, 1);

    // A pair whose handoff is later than the right edge did not stand in this window at all,
    // and it is dropped rather than printed as `0.0m in all` — which is what a pair that stood
    // an hour with no free minute looks like. Found on the live run of the acceptance windows.
    const later = foldDay({
      events,
      turns: [...turns, { role: "dev-core", thread: "054-later", since: "2026-08-30T14:52:53Z" }],
      now,
    });
    expect(later.standing.map((row) => row.thread)).toEqual(["051-merge-ready"]);

    const withPark = foldDay({ events, turns, parks, now });
    expect(withPark.standing[0]?.standingMinutes).toBeCloseTo(30.4, 1);
    // Explicitly zero, and printed as such: a pair with no free part is the case the report
    // exists to distinguish from a pair the box simply ignored.
    expect(withPark.standing[0]?.freeMinutes).toBe(0);
    expect(
      renderDay(withPark).some((line) =>
        line.includes("standing curator×051-merge-ready  30.4m in all  free 0.0m"),
      ),
    ).toBe(true);
  });

  it("prints 60.7 minutes of standing under 2.2 minutes of free tail (curator×052)", () => {
    // The cleanest live observation of the same window (§6.4): the pair stood over an hour
    // while the role worked its way through a queue, and the tail — what the class judges —
    // is the gap since the last of those sessions ended.
    const since = "2026-08-30T09:00:00Z";
    const now = new Date("2026-08-30T10:00:42Z");
    const events = [
      ...session("2026-08-30T09:02:00Z", "2026-08-30T09:31:00Z", "curator", "045-other"),
      ...session("2026-08-30T09:31:25Z", "2026-08-30T09:58:30Z", "curator", "047-other"),
    ];
    const report = foldDay({
      events,
      turns: [{ role: "curator", thread: "052-day-report", since }],
      now,
    });
    expect(report.standing[0]?.standingMinutes).toBeCloseTo(60.7, 1);
    expect(report.standing[0]?.freeMinutes).toBeCloseTo(2.2, 1);
  });

  it("counts the two shares by ONE arithmetic: the report and the courier agree by construction", () => {
    // NOT A TEST OF A VALUE — a test that there is one function. The report is fed the same
    // journal and the same mail as the courier, and the free part it prints is required to be
    // the number `freeTailMinutes` returns and the age `unacceptedTurns` puts on the line.
    const since = "2026-08-30T12:40:00Z";
    const now = new Date("2026-08-30T13:36:30Z");
    const events = [
      ...session("2026-08-30T12:41:10Z", "2026-08-30T13:00:05Z", "curator", "042-other"),
      ...session("2026-08-30T13:01:30Z", "2026-08-30T13:25:06Z", "curator", "047-other"),
    ];
    const parks = [
      { thread: "052-day-report", from: "2026-08-30T12:40:00Z", to: "2026-08-30T12:50:00Z" },
    ];
    const turn = { role: "curator", thread: "052-day-report", since };
    const report = foldDay({ events, turns: [turn], parks, now });

    const { spans } = leaseSpans(events, now);
    expect(report.standing[0]?.freeMinutes).toBe(
      freeTailMinutes({ busy: spans, parks }, turn, now),
    );

    // And the same number, through the courier's own surface: the line it prints about this
    // pair carries the age the report carries, rendered.
    const line = unacceptedTurns({
      turns: [turn],
      raisedAt: new Map(),
      busyRoles: new Set(),
      busy: spans,
      parks,
      now,
      afterMinutes: 10,
    });
    expect(line).toHaveLength(1);
    expect(line[0]?.age).toBe("11m");
    expect(Math.floor(report.standing[0]?.freeMinutes ?? 0)).toBe(11);
  });

  it("invents no span for a release with no acquisition, and says how many it dropped", () => {
    // The tail of a rotated journal: the `lease-acquired` is in the file that is gone. The
    // courier skips such a release (`if (from === undefined) continue`) and the report inherits
    // that — but a report that ate them in silence would print a box less busy than it was, so
    // the count is a row of its own, non-zero here and zero-but-printed everywhere else.
    const events = [
      released("2026-08-30T08:40:00Z", "curator", "051-merge-ready"),
      ...session("2026-08-30T08:45:00Z", "2026-08-30T09:00:00Z", "curator"),
    ];
    const { spans, dropped } = leaseSpans(events, new Date("2026-08-30T09:32:17Z"));
    expect(dropped).toBe(1);
    expect(spans).toEqual([
      { role: "curator", from: "2026-08-30T08:45:00Z", to: "2026-08-30T09:00:00Z" },
    ]);

    const report = foldDay({ events, turns: [], now: new Date("2026-08-30T09:32:17Z") });
    expect(report.droppedReleases).toBe(1);
    expect(report.roles[0]?.busyMinutes).toBeCloseTo(15, 6);
    expect(
      renderDay(report).some((line) =>
        line.includes("releases with no acquisition in this journal: 1"),
      ),
    ).toBe(true);
    // And the line is there on a clean journal too — a boundary that appears only when it is
    // non-zero reads as full coverage on every other day.
    const clean = foldDay({
      events: session("2026-08-30T08:45:00Z", "2026-08-30T09:00:00Z", "curator"),
      turns: [],
      now: new Date("2026-08-30T09:32:17Z"),
    });
    expect(
      renderDay(clean).some((line) =>
        line.includes("releases with no acquisition in this journal: 0"),
      ),
    ).toBe(true);
  });

  it("closes a lease still open at the end of the journal at `now`, and colours nothing", () => {
    const events = [acquired("2026-08-30T09:00:00Z", "dev-core", "042-open")];
    const report = foldDay({ events, turns: [], now: new Date("2026-08-30T09:30:00Z") });
    expect(report.roles[0]?.busyMinutes).toBeCloseTo(30, 6);
    expect(report.roles[0]?.share).toBeCloseTo(1, 6);
    // No verdict is passed on either share — the threshold is john's and is not decided here.
    expect(report.thresholdNote).toContain("no threshold is applied");
    expect(renderDay(report).join("\n")).not.toMatch(/\bok\b|healthy|too (?:high|low)/);
  });

  /**
   * THE PREMISE `parallelism.pairsPerRole` REMOVED (thread `177-workspace-per-pair`). The walk
   * used to key its open leases by the ROLE, which was sound while a role had one workspace and
   * became a fiction the moment it could hold two: the second acquisition overwrote the first,
   * so one session's start was paired with ANOTHER session's release.
   *
   * The stamps are the box's own, read off `journal.jsonl` at `2026-09-13T11:10Z` while this very
   * role held two pairs — the same reason the rest of this file uses live stamps rather than
   * whole hours.
   */
  const twoPairsOfOneRole: OrchestratorEvent[] = [
    acquired("2026-09-13T10:35:14Z", "dev-core", "188-run-park-has-no-lifter"),
    acquired("2026-09-13T10:46:29Z", "dev-core", "189-dead-park-eats-the-verdict"),
    released("2026-09-13T10:46:37Z", "dev-core", "188-run-park-has-no-lifter"),
    acquired("2026-09-13T10:47:17Z", "dev-core", "177-workspace-per-pair"),
    released("2026-09-13T11:00:53Z", "dev-core", "189-dead-park-eats-the-verdict"),
    released("2026-09-13T11:04:05Z", "dev-core", "177-workspace-per-pair"),
  ];

  it("pairs every lease with its OWN release when a role holds more than one at a time", () => {
    const now = new Date("2026-09-13T11:10:00Z");
    const events = [
      ...twoPairsOfOneRole,
      // …and two that are still open at the end of the file, one of them a second session of a
      // thread that already appears above: the key is the pair, so the closed one does not eat it.
      acquired("2026-09-13T11:05:17Z", "dev-core", "177-workspace-per-pair"),
      acquired("2026-09-13T11:05:24Z", "dev-core", "180-selfheal-leaves-the-workspaces-behind"),
    ];
    const { spans, dropped } = leaseSpans(events, now);

    // Five sessions in, five spans out — closed ones in the order they were released, the live
    // ones closed at `now`. Keyed by the role this was three spans, one of which ran from the
    // acquisition of `189` to the release of `188`.
    expect(spans).toEqual([
      { role: "dev-core", from: "2026-09-13T10:35:14Z", to: "2026-09-13T10:46:37Z" },
      { role: "dev-core", from: "2026-09-13T10:46:29Z", to: "2026-09-13T11:00:53Z" },
      { role: "dev-core", from: "2026-09-13T10:47:17Z", to: "2026-09-13T11:04:05Z" },
      { role: "dev-core", from: "2026-09-13T11:05:17Z", to: "2026-09-13T11:10:00.000Z" },
      { role: "dev-core", from: "2026-09-13T11:05:24Z", to: "2026-09-13T11:10:00.000Z" },
    ]);
    // AND NOT ONE OF THEM IS COUNTED AS DROPPED. Every release here answers an acquisition in
    // the same file; the role key made the last two look like releases out of a rotated journal,
    // which is the row that tells the reader the shares below are a lower bound.
    expect(dropped).toBe(0);

    const report = foldDay({ events, turns: [], now });
    expect(report.roles[0]?.sessions).toBe(5);
    expect(report.roles[0]?.busyMinutes).toBeCloseTo(51.9, 6);
    // The window is 34.77 minutes and the role worked 51.9 of them: the share is over 100 % and
    // is NOT capped — two pairs side by side is what it is measuring.
    expect(report.roles[0]?.share).toBeGreaterThan(1);
  });

  it("does not ring the standstill on a role whose second pair blocked it to the end", () => {
    // THE CONSEQUENCE THE COURIER PAYS, and the reason this is not a cosmetic count. The free
    // tail is measured from the END of the last thing that blocked the pair. `dev-core` was busy
    // until `11:04:05` on `177`; keyed by the role, that release was dropped and the last span
    // ended at `11:00:53` — the class would read three extra minutes of idleness that never
    // happened and ring on a saturated box, which is the false-call class #147 was written for.
    const now = new Date("2026-09-13T11:10:00Z");
    const { spans } = leaseSpans(twoPairsOfOneRole, now);
    const turn = {
      role: "dev-core",
      thread: "180-selfheal-leaves-the-workspaces-behind",
      since: "2026-09-13T10:40:00Z",
    };

    expect(freeTailMinutes({ busy: spans }, turn, now)).toBeCloseTo(5.92, 2);
    expect(
      unacceptedTurns({
        turns: [turn],
        raisedAt: new Map(),
        busyRoles: new Set(),
        busy: spans,
        now,
        afterMinutes: 7,
      }),
    ).toEqual([]);
  });
});
