/**
 * THE ACCOUNT-REACH DOOR (thread `047-devops-role`, msg-089 point 2).
 *
 * The case these assertions are written from is a measured one, not an invented one: on
 * 2026-09-02 role `devops` was raised as `aco-devops` and pointed at
 * `/home/lle/.claude-lle-second` — a directory of another user, mode `600`. The session
 * died at the vendor with "Not logged in", the account went on the shelf, and every pair
 * spending it stopped, `dev-core` included. So the tests come in two halves: the
 * permission arithmetic (which is the kernel's rule, and getting it wrong in the
 * permissive direction is this door failing open), and the refusal itself — that it fires
 * on exactly the shapes that killed that launch, and on nothing a working circuit does.
 */
import { describe, expect, it } from "vitest";

import type { Role } from "../roles/schema.js";
import {
  type AccountReach,
  accountReachRefusal,
  type PathFacts,
  permits,
} from "./account-reach.js";

const ROLE = { id: "devops", systemUser: "aco-devops" } as unknown as Role;
const ACCOUNT = { id: "lle-second", configDir: "/home/lle/.claude-lle-second" } as const;
const SUDO = { mode: "sudo", user: "aco-devops" } as const;
const THEM = { uid: 1001, gids: [1001, 1002] } as const;

const dir = (facts: Partial<PathFacts> & { readonly path: string }): PathFacts => ({
  present: true,
  mode: 0o755,
  uid: 0,
  gid: 0,
  ...facts,
});

/** A box where everything is right: the ancestors traverse and the directory is the user's own. */
const reachable: AccountReach = {
  user: "aco-devops",
  identity: THEM,
  ancestors: [dir({ path: "/home" })],
  dir: dir({ path: "/home/aco-devops/.claude", mode: 0o700, uid: 1001, gid: 1001 }),
};

describe("permits", () => {
  it("takes the FIRST matching class, as the kernel does — not the union of the three", () => {
    // The owner of a `0o070` directory has no access to it: the kernel stops at the owner
    // class. A union would answer `true`, and this door would pass a launch that then dies.
    expect(permits(dir({ path: "/x", mode: 0o070, uid: 1001, gid: 1001 }), THEM, 0o4)).toBe(false);
    // ... and the group class is reached only when the uid does NOT match.
    expect(permits(dir({ path: "/x", mode: 0o070, uid: 0, gid: 1001 }), THEM, 0o4)).toBe(true);
  });

  it("counts a supplementary group, not just the primary one", () => {
    expect(permits(dir({ path: "/x", mode: 0o750, uid: 0, gid: 1002 }), THEM, 0o5)).toBe(true);
  });

  it("says false about a path the box could not stat, rather than guessing", () => {
    expect(permits({ path: "/x", present: false, detail: "ENOENT" }, THEM, 0o4)).toBe(false);
  });
});

describe("accountReachRefusal", () => {
  it("says nothing when the session is not switching identity — every role running today", () => {
    // The bits of the directory are irrelevant here BY CONSTRUCTION: the session runs as
    // this process's own user and reads what this process reads. A door that fired on this
    // branch would stop the whole circuit to protect the one role that switches.
    expect(
      accountReachRefusal({
        role: { id: "dev-core" } as unknown as Role,
        as: { mode: "self" },
        account: ACCOUNT,
        reach: undefined,
      }),
    ).toBeUndefined();
  });

  it("says nothing when no account is named — the tool takes the target user's own home", () => {
    expect(accountReachRefusal({ role: ROLE, as: SUDO, reach: undefined })).toBeUndefined();
  });

  it("passes a directory the target user owns", () => {
    expect(
      accountReachRefusal({
        role: ROLE,
        as: SUDO,
        account: { id: "devops-main", configDir: "/home/aco-devops/.claude" },
        reach: reachable,
      }),
    ).toBeUndefined();
  });

  it("REFUSES THE FIELD CASE: another user's directory at mode 600, and names all four facts", () => {
    const said = accountReachRefusal({
      role: ROLE,
      as: SUDO,
      account: ACCOUNT,
      reach: {
        user: "aco-devops",
        identity: THEM,
        ancestors: [dir({ path: "/home" }), dir({ path: "/home/lle", mode: 0o755, uid: 1000 })],
        dir: dir({ path: ACCOUNT.configDir, mode: 0o600, uid: 1000, gid: 1000 }),
      },
    });
    // A refusal that cannot be acted on is the defect this module was written against, so
    // the wording is part of the contract: the role, the user, the account and the path.
    expect(said).toContain("devops");
    expect(said).toContain("aco-devops");
    expect(said).toContain("lle-second");
    expect(said).toContain("/home/lle/.claude-lle-second");
    // ... the bits as `ls -ld` prints them, and the owner it belongs to instead
    expect(said).toContain("mode 0600");
    expect(said).toContain("uid 1000");
    // ... and the layer the operator would otherwise be sent to, named as the wrong one
    expect(said).toContain("Not logged in");
    expect(said).toContain("docs/box-setup.md §0.1a");
  });

  it("names the ANCESTOR that blocks, not the directory behind it", () => {
    // `/home/lle` at 0700 makes every directory under it unreachable whatever its own bits
    // say. Naming the leaf here would send an operator to `chmod` a directory that is
    // already fine.
    const said = accountReachRefusal({
      role: ROLE,
      as: SUDO,
      account: ACCOUNT,
      reach: {
        user: "aco-devops",
        identity: THEM,
        ancestors: [dir({ path: "/home" }), dir({ path: "/home/lle", mode: 0o700, uid: 1000 })],
        dir: dir({ path: ACCOUNT.configDir, mode: 0o777, uid: 1000, gid: 1000 }),
      },
    });
    expect(said).toContain("cannot traverse");
    expect(said).toContain("/home/lle");
    expect(said).not.toContain("may not");
  });

  it("refuses a directory that is readable but not writable — the store lives there too", () => {
    const said = accountReachRefusal({
      role: ROLE,
      as: SUDO,
      account: ACCOUNT,
      reach: { ...reachable, dir: dir({ path: ACCOUNT.configDir, mode: 0o555, uid: 0, gid: 0 }) },
    });
    expect(said).toContain("may not w");
  });

  it("refuses an absent directory by saying it does not exist, not by saying 'permission'", () => {
    const said = accountReachRefusal({
      role: ROLE,
      as: SUDO,
      account: ACCOUNT,
      reach: {
        ...reachable,
        dir: { path: ACCOUNT.configDir, present: false, detail: "ENOENT: no such file" },
      },
    });
    expect(said).toContain("does not exist on this box");
    expect(said).toContain("ENOENT");
  });

  it("refuses when the box cannot say who the user is — no uid, nothing to judge", () => {
    const said = accountReachRefusal({
      role: ROLE,
      as: SUDO,
      account: ACCOUNT,
      reach: {
        user: "aco-devops",
        identityDetail: "'id -u aco-devops' gave no uid",
        ancestors: [],
        dir: dir({ path: ACCOUNT.configDir }),
      },
    });
    expect(said).toContain("cannot say who 'aco-devops' is");
    expect(said).toContain("gave no uid");
  });

  it("refuses when the caller switched identity but asked the box nothing", () => {
    // The silent pass is the whole defect: a launch that skipped the probe must not be a
    // launch that passed the door.
    expect(
      accountReachRefusal({ role: ROLE, as: SUDO, account: ACCOUNT, reach: undefined }),
    ).toContain("did not ask the box");
  });
});
