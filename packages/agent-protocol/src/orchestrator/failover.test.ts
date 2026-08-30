import { describe, expect, it } from "vitest";
import {
  type AccountChoice,
  type AccountRefusal,
  chainRefusals,
  chooseAccount,
  describeAccountPause,
  describeChainRefusal,
  describeFailover,
  describeRefusals,
} from "./failover.js";
import { openQuotaShelves, type QuotaShelf, quotaSignalOf } from "./quota.js";

const shelf = (account: string, until: string, window = "five_hour"): QuotaShelf => ({
  account,
  window,
  until,
  since: "2026-08-29T09:00:00Z",
  stated: true,
  role: "dev-core",
});

const CLAUDE = "claude-code";
const accounts = {
  "acme-main": { kind: CLAUDE },
  "acme-second": { kind: CLAUDE },
  "codex-main": { kind: "codex" },
};

describe("chooseAccount — (а) a closed window moves the next session to the first spare of the same kind", () => {
  it("switches, and names the window it ran from", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("failover");
    const failover = choice as Extract<AccountChoice, { kind: "failover" }>;
    expect(failover.account).toBe("acme-second");
    expect(failover.from).toBe("acme-main");
    expect(failover.shelf.until).toBe("2026-08-29T14:00:00Z");
  });

  it("the switch is LOUD — one line naming who moved, off what and until when (§4)", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    }) as Extract<AccountChoice, { kind: "failover" }>;
    const line = describeFailover({ role: "dev-core", choice });
    expect(line).toContain("dev-core");
    expect(line).toContain("acme-second");
    expect(line).toContain("acme-main");
    expect(line).toContain("14:00Z");
  });

  it("takes the FIRST open link of the chain, not the last — the order is the policy", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second", "spare-third"],
      worker: CLAUDE,
      accounts: { ...accounts, "spare-third": { kind: CLAUDE } },
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    }) as Extract<AccountChoice, { kind: "failover" }>;
    expect(choice.account).toBe("acme-second");
  });

  it("walks PAST a shelved fall-back to the next open one", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second", "spare-third"],
      worker: CLAUDE,
      accounts: { ...accounts, "spare-third": { kind: CLAUDE } },
      shelves: [
        shelf("acme-main", "2026-08-29T14:00:00Z"),
        shelf("acme-second", "2026-08-29T15:00:00Z"),
      ],
    }) as Extract<AccountChoice, { kind: "failover" }>;
    expect(choice.account).toBe("spare-third");
  });

  it("the box's own account is a link like any other — silence is a key, not a gap", () => {
    const choice = chooseAccount({
      fallback: ["acme-second"],
      worker: CLAUDE,
      accounts,
      // The box's own account shelves under the empty id (BOX_ACCOUNT).
      shelves: [shelf("", "2026-08-29T14:00:00Z")],
    }) as Extract<AccountChoice, { kind: "failover" }>;
    expect(choice.kind).toBe("failover");
    expect(choice.account).toBe("acme-second");
    expect(choice.from).toBe("");
  });
});

describe("chooseAccount — (б) only a QUOTA shelf moves a role, nothing else does", () => {
  it("an open window keeps the role where it is, however long the chain", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second"],
      worker: CLAUDE,
      accounts,
      shelves: [],
    });
    expect(choice).toEqual({ kind: "stay", account: "acme-main", refusals: [] });
  });

  it("a neighbour's closed window is not this role's — no switch on somebody else's shelf", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("codex-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("stay");
  });

  it("a network failure and a 5xx open NO shelf, so the chain never moves (the trigger, end to end)", () => {
    // The signal half: neither line is a quota signal…
    for (const line of [
      JSON.stringify({ type: "result", result: "API Error: 503 upstream connect error" }),
      "fetch failed: ECONNRESET",
      JSON.stringify({ type: "result", result: "Internal server error (500)" }),
    ])
      expect(quotaSignalOf(line)).toBeUndefined();
    // …so nothing of that kind is in the journal as a quota release, the shelves are
    // empty, and the choice is `stay`. This is the whole of requirement §2: the switch
    // rides the shelf and there is no second, looser door into it.
    const shelves = openQuotaShelves(
      [
        {
          kind: "lease-released",
          ts: "2026-08-29T09:00:00Z",
          role: "dev-core",
          reason: "exited-without-handoff",
          account: "acme-main",
        },
      ],
      new Date("2026-08-29T09:01:00Z"),
    );
    expect(shelves).toHaveLength(0);
    expect(
      chooseAccount({
        primary: "acme-main",
        fallback: ["acme-second"],
        worker: CLAUDE,
        accounts,
        shelves,
      }).kind,
    ).toBe("stay");
  });
});

describe("chooseAccount — (в) nothing spare left is a PAUSE with a clock, not silence", () => {
  it("names the earliest reopening across the whole chain", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-second"],
      worker: CLAUDE,
      accounts,
      shelves: [
        shelf("acme-main", "2026-08-29T16:00:00Z"),
        shelf("acme-second", "2026-08-29T14:30:00Z"),
      ],
    });
    expect(choice.kind).toBe("paused");
    const paused = choice as Extract<AccountChoice, { kind: "paused" }>;
    expect(paused.until.account).toBe("acme-second");
    const line = describeAccountPause({ role: "dev-core", choice: paused });
    expect(line).toContain("held until 14:30Z");
  });
});

describe("chooseAccount — (г) an empty chain is today's behaviour, to the line", () => {
  it("a role with no fall-backs pauses on its own shelf and switches nowhere", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("paused");
    expect((choice as Extract<AccountChoice, { kind: "paused" }>).until.account).toBe("acme-main");
    expect(choice.refusals).toEqual([]);
  });

  it("an empty list is the same answer as no list at all", () => {
    const shelves = [shelf("acme-main", "2026-08-29T14:00:00Z")];
    expect(
      chooseAccount({ primary: "acme-main", fallback: [], worker: CLAUDE, accounts, shelves }),
    ).toEqual(chooseAccount({ primary: "acme-main", worker: CLAUDE, accounts, shelves }));
  });
});

describe("chooseAccount — (д) a spare of another kind is refused BY NAME, never spent", () => {
  it("refuses the codex account of a claude-code role, and says both kinds", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["codex-main"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("paused");
    expect(choice.refusals).toHaveLength(1);
    const [refusal] = choice.refusals;
    expect(refusal?.id).toBe("codex-main");
    expect(refusal?.reason).toContain("codex");
    expect(refusal?.reason).toContain(CLAUDE);
    expect(describeRefusals({ role: "dev-core", refusals: choice.refusals })[0]).toContain(
      "is NOT spent",
    );
  });

  it("refuses it and CARRIES ON — one bad link does not stand a role down", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["codex-main", "acme-second"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("failover");
    expect((choice as Extract<AccountChoice, { kind: "failover" }>).account).toBe("acme-second");
    expect(choice.refusals.map((r) => r.id)).toEqual(["codex-main"]);
  });

  it("an account this machine does not declare is refused by name, not replaced by the box's own", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["nowhere"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("paused");
    expect(choice.refusals[0]?.reason).toContain("accounts.nowhere.configDir");
  });

  it("a machine that claims no kind for an account is not a mismatch — silence is 'nothing claimed'", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["quiet-spare"],
      worker: CLAUDE,
      accounts: { ...accounts, "quiet-spare": {} },
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("failover");
  });

  it("the role's own account named as its own fall-back is refused by name", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["acme-main"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.kind).toBe("paused");
    expect(choice.refusals[0]?.reason).toContain("already spends");
  });

  it("a repeated link is walked once and produces one refusal, not two", () => {
    const choice = chooseAccount({
      primary: "acme-main",
      fallback: ["nowhere", "nowhere"],
      worker: CLAUDE,
      accounts,
      shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
    });
    expect(choice.refusals).toHaveLength(1);
  });
});

/**
 * THE DOOR OF THE CONFIG (thread 036, step 2, point 2) — the same chain judged where it is
 * WRITTEN. `chooseAccount` reaches a fall-back only when the primary is already shelved, so
 * every one of these defects would otherwise be met at the moment quota runs out; here the
 * question is asked with nobody waiting, which is the only moment the repair is cheap.
 */
describe("chainRefusals — every crooked link refused BY NAME at the moment it is declared", () => {
  it("an id THIS MACHINE does not declare is refused, and the sentence names the key to write", () => {
    const found = chainRefusals({
      primary: "acme-main",
      fallback: ["acme-thrid"],
      worker: CLAUDE,
      accounts,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("acme-thrid");
    expect(found[0]?.reason).toContain("declares no such account");
    expect(found[0]?.reason).toContain("accounts.acme-thrid.configDir");
    expect(
      describeChainRefusal({ role: "dev-core", refusal: found[0] as AccountRefusal }),
    ).toContain("role 'dev-core': the fall-back 'acme-thrid' ('roles[].launch.fallback')");
  });

  it("an account of ANOTHER KIND is refused with both kinds named", () => {
    const found = chainRefusals({ primary: "acme-main", fallback: ["codex-main"], worker: CLAUDE });
    // The machine was not read here, so the kind refusal cannot be made from it…
    expect(found).toHaveLength(0);
    const withMachine = chainRefusals({
      primary: "acme-main",
      fallback: ["codex-main"],
      worker: CLAUDE,
      accounts,
    });
    expect(withMachine[0]?.reason).toContain("declares it as 'codex'");
    expect(withMachine[0]?.reason).toContain("raised as 'claude-code'");
  });

  it("THE ROLE'S OWN ACCOUNT in its own chain is refused even when the machine was not read", () => {
    const found = chainRefusals({ primary: "acme-main", fallback: ["acme-main"], worker: CLAUDE });
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain("already spends");
  });

  it("THE SAME ID TWICE is a finding here, though the runtime walks it once in silence", () => {
    const found = chainRefusals({
      primary: "acme-main",
      fallback: ["acme-second", "acme-second"],
      worker: CLAUDE,
      accounts,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe("acme-second");
    expect(found[0]?.reason).toContain("named twice");
    // …and the runtime says nothing about it, which is the difference being asserted.
    expect(
      chooseAccount({
        primary: "acme-main",
        fallback: ["acme-second", "acme-second"],
        worker: CLAUDE,
        accounts,
        shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
      }).refusals,
    ).toHaveLength(0);
  });

  it("A LIVE LINK BEHIND A CROOKED ONE still stands: the chain is judged, not dropped", () => {
    const found = chainRefusals({
      primary: "acme-main",
      fallback: ["acme-thrid", "acme-second"],
      worker: CLAUDE,
      accounts,
    });
    expect(found.map((refusal) => refusal.id)).toEqual(["acme-thrid"]);
    expect(
      chooseAccount({
        primary: "acme-main",
        fallback: ["acme-thrid", "acme-second"],
        worker: CLAUDE,
        accounts,
        shelves: [shelf("acme-main", "2026-08-29T14:00:00Z")],
      }),
    ).toMatchObject({ kind: "failover", account: "acme-second" });
  });

  it("AN ABSENT CHAIN AND AN EMPTY ONE ARE THE SAME ANSWER — the door finds nothing in either", () => {
    const absent = chainRefusals({ primary: "acme-main", worker: CLAUDE, accounts });
    const empty = chainRefusals({ primary: "acme-main", fallback: [], worker: CLAUDE, accounts });
    expect(absent).toEqual([]);
    expect(empty).toEqual(absent);
  });

  it("a healthy chain is silent — a door that shouts at a correct config is a door nobody reads", () => {
    expect(
      chainRefusals({
        primary: "acme-main",
        fallback: ["acme-second"],
        worker: CLAUDE,
        accounts,
      }),
    ).toEqual([]);
  });
});
