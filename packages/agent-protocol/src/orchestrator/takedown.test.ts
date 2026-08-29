/**
 * The takedown speaks (thread `047-devops-role`). The measurement behind these cases is
 * in `takedown.ts`: three sites swallowed every errno under a comment that named only
 * `ESRCH`, so `EPERM` — the group is alive and belongs to someone else — was reported as
 * "already gone".
 */
import { describe, expect, it } from "vitest";

import { groupTakedownComplaint, putGroupDown, TAKEDOWN_SIGNAL } from "./takedown.js";

const errno = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`kill ${code}`), { code });

describe("groupTakedownComplaint", () => {
  it("says nothing for ESRCH — the group is already gone, which is the benign outcome", () => {
    expect(groupTakedownComplaint({ pid: 4242, error: errno("ESRCH") })).toBeUndefined();
  });

  it("names EPERM as ALIVE and owned by another user, not as gone", () => {
    const said = groupTakedownComplaint({ pid: 4242, error: errno("EPERM") });
    expect(said).toBeDefined();
    // the three things a reader needs: which group, what happened, what it costs
    expect(said).toContain("-4242");
    expect(said).toContain("ALIVE");
    expect(said).toContain("another system user");
    expect(said).toContain("second session on the same thread");
    // and the repair as a command, because nothing here retries
    expect(said).toContain("kill -TERM -4242");
  });

  it("names an unexpected errno by its code rather than falling through in silence", () => {
    const said = groupTakedownComplaint({ pid: 7, error: errno("EINVAL") });
    expect(said).toContain("EINVAL");
    expect(said).toContain("-7");
  });

  it("survives a throw that is not an errno at all and quotes its message", () => {
    const said = groupTakedownComplaint({ pid: 7, error: new Error("nothing like an errno") });
    expect(said).toContain("nothing like an errno");
  });
});

describe("putGroupDown", () => {
  it("signals the WHOLE group with SIGTERM and says nothing when it lands", () => {
    const sent: Array<{ target: number; signal: string }> = [];
    const said: string[] = [];
    const ok = putGroupDown({
      pid: 900,
      say: (text) => said.push(text),
      kill: (target, signal) => {
        sent.push({ target, signal });
      },
    });
    expect(ok).toBe(true);
    expect(sent).toEqual([{ target: -900, signal: TAKEDOWN_SIGNAL }]);
    expect(said).toEqual([]);
  });

  it("stays silent on ESRCH and reports the failure — the group was not signalled", () => {
    const said: string[] = [];
    const ok = putGroupDown({
      pid: 900,
      say: (text) => said.push(text),
      kill: () => {
        throw errno("ESRCH");
      },
    });
    expect(ok).toBe(false);
    expect(said).toEqual([]);
  });

  it("hands the complaint to `say` on EPERM", () => {
    const said: string[] = [];
    const ok = putGroupDown({
      pid: 900,
      say: (text) => said.push(text),
      kill: () => {
        throw errno("EPERM");
      },
    });
    expect(ok).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("-900");
    expect(said[0]).toContain("ALIVE");
  });
});
