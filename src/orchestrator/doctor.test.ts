import { describe, expect, it } from "vitest";
import {
  accountChecksWithoutAccounts,
  accountChecksWithoutRoles,
  accountLiveCheck,
  agentChecksWithoutRoles,
  agentLiveCheck,
  boxIdentityCheck,
  boxRaisesNoRoles,
  type CommitIdentity,
  commitIdentityCheck,
  dictionaryAt,
  doctorPassed,
  doctorSummary,
  gitChecks,
  IDENTITY_DICTIONARY_UNDECLARED,
  identityVerdict,
  instanceCheck,
  MACHINERY_IDENTITY,
  machineConfigCheck,
  mailPresenceCheck,
  maskedRemote,
  repositoryConfigCheck,
} from "./doctor.js";
import { agentBinaryVerdict, type PreflightCheck } from "./preflight.js";

describe("the repository config row", () => {
  it("passes with the ref it was read at, because a config is only true at one", () => {
    const check = repositoryConfigCheck({
      path: "agent-protocol.json",
      ref: "origin/main",
      roles: 5,
      issues: [],
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("origin/main");
    expect(check.detail).toContain("5 roles");
  });

  it("fails carrying the issues of 'config check' verbatim, not a count of them", () => {
    const check = repositoryConfigCheck({
      path: "agent-protocol.json",
      ref: "origin/main",
      roles: 5,
      issues: ["role 'dev-core' is owned by no instance", "role 'curator' is owned by two"],
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("owned by no instance");
    expect(check.detail).toContain("owned by two");
  });
});

describe("the machine config row", () => {
  it("is a FACT when the file is absent — a box on PATH that raises nobody is legitimate", () => {
    const check = machineConfigCheck({
      path: "/home/x/.config/agent-protocol/local.json",
      found: false,
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("absent");
  });

  it("fails when the file is there and unreadable: somebody meant it to be read", () => {
    const check = machineConfigCheck({
      path: "/home/x/.config/agent-protocol/local.json",
      found: true,
      error: "'local.json' carries 'roles' — that is POLICY",
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("POLICY");
  });

  it("passes with the summary the rest of the CLI prints, so two readers agree", () => {
    const check = machineConfigCheck({
      path: "/home/x/.config/agent-protocol/local.json",
      found: true,
      summary: "/home/x/.config/agent-protocol/local.json — claude-code → /usr/bin/claude",
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("claude-code");
  });
});

describe("which instance this box is (R13)", () => {
  const localConfigPath = "/home/x/.config/agent-protocol/local.json";

  it("is a fact when the repository declares no topology at all", () => {
    const check = instanceCheck({ declared: [], localConfigPath });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("one box, every role");
  });

  it("fails when the box names an instance the repository does not know it has", () => {
    const check = instanceCheck({ instance: "lle-agents", declared: [], localConfigPath });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("nothing to join to");
  });

  it("fails on a nameless box while the repository declares instances — it raises nobody", () => {
    const check = instanceCheck({ declared: ["laptop", "lle-agents"], localConfigPath });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("raises nobody");
    expect(check.detail).toContain(localConfigPath);
  });

  it("calls an UNDECLARED name a bench, not an error (curator's split in the statement)", () => {
    const check = instanceCheck({
      instance: "my-laptop",
      declared: ["laptop", "lle-agents"],
      localConfigPath,
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("bench");
    expect(check.detail).toContain("'laptop'");
  });

  it("passes naming the roles that box is the one to raise", () => {
    const check = instanceCheck({
      instance: "lle-agents",
      declared: ["laptop", "lle-agents"],
      roles: ["dev-core", "curator"],
      localConfigPath,
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("dev-core, curator");
  });
});

describe("the agent rows follow the fact of the box (thread 052)", () => {
  const declared = ["laptop", "lle-agents"];

  it("a box with roles is asked both questions, whatever the binary answers", () => {
    expect(
      boxRaisesNoRoles({ instance: "lle-agents", declared, roles: ["dev-core", "curator"] }),
    ).toBeUndefined();
  });

  it("a repository with no topology is one box with every role — the questions stand", () => {
    expect(boxRaisesNoRoles({ declared: [] })).toBeUndefined();
    expect(boxRaisesNoRoles({ instance: "my-laptop", declared: [] })).toBeUndefined();
  });

  it("an UNDECLARED name is a bench: it raises nothing, so it is asked nothing", () => {
    expect(boxRaisesNoRoles({ instance: "my-laptop", declared })).toContain("bench");
  });

  it("a declared box with no role assigned to it raises nothing either", () => {
    expect(boxRaisesNoRoles({ instance: "lle-agents", declared, roles: [] })).toContain(
      "no role of the project is assigned to it",
    );
  });

  it("NO NAME is not NO ROLES — an unconfigured box keeps being asked (curator's boundary)", () => {
    expect(boxRaisesNoRoles({ declared })).toBeUndefined();
  });

  it("the rows of a box without roles are dots with the reason, and keep their names", () => {
    const rows = agentChecksWithoutRoles("'my-laptop' is not declared in the repository — a bench");

    expect(rows.map((row) => row.status)).toEqual(["info", "info"]);
    expect(rows.map((row) => row.name)).toEqual(["agent: binary", "agent: headless run"]);
    for (const row of rows) expect(row.detail).toContain("bench");
    // A box that raises nothing is READY: dots do not stop it, so the acceptance
    // criterion "green doctor on the bench" is reachable — which it was not before.
    expect(doctorPassed([...rows])).toBe(true);
  });
});

/**
 * THE FOUR CELLS OF THE ACCEPTANCE (thread 052) — the box (raises roles / raises none)
 * against the binary (there / missing), assembled the way `doctor` assembles them, so
 * the table is a statement about the COMMAND and not about one of its helpers.
 *
 * The point of holding all four: the change may only touch the bottom row. A box with
 * roles keeps failing on a missing binary — that cross is what commissioning is for —
 * and a box with none stops being asked at all, whatever is on its PATH.
 */
describe("the four cells: what each kind of box is asked about the agent", () => {
  const rowsOf = (input: {
    readonly raisesRoles: boolean;
    readonly binaryFound: boolean;
  }): readonly PreflightCheck[] => {
    const reason = boxRaisesNoRoles({
      instance: input.raisesRoles ? "lle-agents" : "my-laptop",
      declared: ["lle-agents"],
      ...(input.raisesRoles ? { roles: ["dev-core"] } : {}),
    });
    if (reason !== undefined) return agentChecksWithoutRoles(reason);
    return [
      agentBinaryVerdict({
        worker: "claude-code",
        exec: "claude",
        source: "machine",
        resolved: input.binaryFound ? "/usr/bin/claude" : null,
      }),
      agentLiveCheck({
        worker: "claude-code",
        outcome: input.binaryFound
          ? { ok: true, detail: "answered" }
          : { skipped: "the binary was not found — there is nothing to run" },
      }),
    ];
  };

  it.each([
    { raisesRoles: true, binaryFound: true, statuses: ["ok", "ok"], ready: true },
    { raisesRoles: true, binaryFound: false, statuses: ["fail", "info"], ready: false },
    { raisesRoles: false, binaryFound: true, statuses: ["info", "info"], ready: true },
    { raisesRoles: false, binaryFound: false, statuses: ["info", "info"], ready: true },
  ])(
    "roles: $raisesRoles, binary: $binaryFound → $statuses (ready: $ready)",
    ({ raisesRoles, binaryFound, statuses, ready }) => {
      const rows = rowsOf({ raisesRoles, binaryFound });

      expect(rows.map((row) => row.status)).toEqual(statuses);
      expect(doctorPassed([...rows])).toBe(ready);
    },
  );
});

describe("the headless probe — the moment of truth of a box", () => {
  it("passes on an answer and never prints the answer itself", () => {
    const check = agentLiveCheck({
      worker: "claude-code",
      outcome: { ok: true, detail: "answered in 3.1s" },
    });
    expect(check.status).toBe("ok");
    expect(check.name).toContain("claude-code");
  });

  it("fails carrying the tool's own words — a dead token and a missing binary differ", () => {
    const check = agentLiveCheck({
      worker: "claude-code",
      outcome: { ok: false, detail: "Invalid API key · Please run /login" },
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("/login");
  });

  it("is a FACT when it was not asked: --offline must neither redden nor bless the row", () => {
    const check = agentLiveCheck({
      worker: "claude-code",
      outcome: { skipped: "--offline" },
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("--offline");
  });
});

describe("is the token of account X alive (B.4)", () => {
  const probe = (outcome: Parameters<typeof accountLiveCheck>[0]["outcome"]) =>
    accountLiveCheck({ id: "second", configDir: "/home/j/.claude-second", outcome });

  it("names the account in the row — one row per subscription, not one per box", () => {
    const check = probe({ ok: true, detail: "answered in 2.4s" });
    expect(check.status).toBe("ok");
    expect(check.name).toContain("'second'");
  });

  it("a dead token spells the ONE repair, with the directory in it", () => {
    const check = probe({ ok: false, detail: "Invalid API key · Please run /login" });
    expect(check.status).toBe("fail");
    // The tool's own words are kept — a dead token and a timeout are different evenings.
    expect(check.detail).toContain("Invalid API key");
    expect(check.detail).toContain("CLAUDE_CONFIG_DIR=/home/j/.claude-second claude login");
  });

  it("a passing row does NOT carry the login instruction — there is nothing to repair", () => {
    expect(probe({ ok: true, detail: "answered in 2.4s" }).detail).not.toContain("claude login");
  });

  it("not asked is a fact, not a pass: --offline leaves the row neither red nor green", () => {
    const check = probe({ skipped: "--offline" });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("--offline");
  });

  it("a box with no 'accounts' section says so instead of being silent about accounts", () => {
    const rows = accountChecksWithoutAccounts();
    expect(rows.map((row) => row.status)).toEqual(["info"]);
    expect(rows[0]?.detail).toContain("the box's own login");
    // An info row must not make doctor fail — it is a fact about the box, not a defect.
    expect(doctorPassed([...rows])).toBe(true);
  });

  it("a box that raises nothing keeps the account NAMES — silence would read as 'none'", () => {
    const rows = accountChecksWithoutRoles({
      reason: "'my-laptop' is not declared in the repository — a bench",
      accounts: ["main", "second"],
    });
    // The same names as the live rows, so two boxes' checklists compare line by line.
    expect(rows.map((row) => row.name)).toEqual([
      "account: 'main' token",
      "account: 'second' token",
    ]);
    expect(rows.map((row) => row.status)).toEqual(["info", "info"]);
    for (const row of rows) expect(row.detail).toContain("bench");
    expect(doctorPassed([...rows])).toBe(true);
  });

  it("raises nothing AND declares nothing — the ordinary 'no accounts' row, not a second wording", () => {
    expect(accountChecksWithoutRoles({ reason: "a bench", accounts: [] })).toEqual(
      accountChecksWithoutAccounts(),
    );
  });
});

describe("what git owes an unattended box", () => {
  it("fails without an origin, and prints the url as a fact when there is one", () => {
    const [origin] = gitChecks({
      origin: null,
      fetch: { ok: true, detail: "" },
      push: { ok: true, detail: "" },
    });
    expect(origin?.status).toBe("fail");
    const [named] = gitChecks({
      origin: "git@github.com:org/repo.git",
      fetch: { ok: true, detail: "" },
      push: { ok: true, detail: "" },
    });
    expect(named?.status).toBe("info");
    expect(named?.detail).toContain("github.com");
  });

  it("fails the write probe with the remote's refusal, not with a summary of it", () => {
    const checks = gitChecks({
      origin: "git@github.com:org/repo.git",
      fetch: { ok: true, detail: "reachable" },
      push: { ok: false, detail: "remote: Permission to org/repo.git denied to lle-agents" },
    });
    const push = checks.find((check) => check.name.includes("write access"));
    expect(push?.status).toBe("fail");
    expect(push?.detail).toContain("denied to lle-agents");
  });

  it("masks a credential in the origin url — the row is written to be pasted into a chat", () => {
    const [origin] = gitChecks({
      origin: "https://x-access-token:ghs_liveTokenValue@github.com/org/repo.git",
      fetch: { ok: true, detail: "" },
      push: { ok: true, detail: "" },
    });
    expect(origin?.detail).not.toContain("ghs_liveTokenValue");
    // The KIND of credential and the remote stay readable — a masked row nobody can
    // read tells the operator less than no row at all.
    expect(origin?.detail).toBe("https://x-access-token:***@github.com/org/repo.git");
  });

  it("reports a skipped write probe as a fact, naming why it was not asked", () => {
    const checks = gitChecks({
      origin: "git@github.com:org/repo.git",
      fetch: { skipped: "--offline" },
      push: { skipped: "--offline" },
    });
    expect(checks.filter((check) => check.status === "info")).toHaveLength(3);
  });
});

describe("the mail checkout as a box question", () => {
  it("fails when it is not there, and names the fetch the creation needs", () => {
    const check = mailPresenceCheck({ path: "/srv/repo/.worktrees/comms", present: false });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("fetch");
  });

  it("passes naming the path, so the reader knows which checkout was judged", () => {
    const check = mailPresenceCheck({ path: "/srv/repo/.worktrees/comms", present: true });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain(".worktrees/comms");
  });
});

describe("the one line that is the answer", () => {
  const rows: readonly PreflightCheck[] = [
    { name: "config: repository", status: "ok", detail: "" },
    { name: "config: machine", status: "info", detail: "" },
    { name: "git: fetch", status: "ok", detail: "" },
  ];

  it("is green only when nothing failed, and says how much was actually compared", () => {
    expect(doctorPassed(rows)).toBe(true);
    expect(doctorSummary(rows)).toContain("green");
    expect(doctorSummary(rows)).toContain("2 checks passed");
    expect(doctorSummary(rows)).toContain("1 facts");
  });

  it("names the failed rows, because 'doctor is red' is not a repair instruction", () => {
    const red: readonly PreflightCheck[] = [
      ...rows,
      { name: "git: write access (dry-run push)", status: "fail", detail: "" },
    ];
    expect(doctorPassed(red)).toBe(false);
    expect(doctorSummary(red)).toContain("git: write access");
    expect(doctorSummary(red)).toContain("1 of 4");
  });

  it("does not let a fact refuse a verdict (R12) — a box of facts alone is green", () => {
    const facts: readonly PreflightCheck[] = [
      { name: "config: machine", status: "info", detail: "" },
    ];
    expect(doctorPassed(facts)).toBe(true);
    expect(doctorSummary(facts)).toContain("green");
  });
});

/**
 * THE MASKING AS ITS OWN QUESTION (rule 10 of the project, the reviewer's finding on
 * PR #130): an automation clone puts a live token in the url, and this checklist is
 * built to be read by a human and pasted where humans paste things.
 */
describe("the remote url as it may be printed", () => {
  it("drops a lone userinfo whole — a token sits exactly there and has no name", () => {
    expect(maskedRemote("https://ghs_liveTokenValue@github.com/org/repo.git")).toBe(
      "https://***@github.com/org/repo.git",
    );
  });

  it("leaves an ssh remote alone: a key authenticates it, so 'git@' is a login", () => {
    expect(maskedRemote("git@github.com:org/repo.git")).toBe("git@github.com:org/repo.git");
    expect(maskedRemote("ssh://git@github.com/org/repo.git")).toBe(
      "ssh://git@github.com/org/repo.git",
    );
  });

  it("touches nothing in a url that carries no credential at all", () => {
    expect(maskedRemote("https://github.com/org/repo.git")).toBe("https://github.com/org/repo.git");
    expect(maskedRemote("/srv/git/repo.git")).toBe("/srv/git/repo.git");
  });
});

/**
 * WHO SIGNED THE HISTORY (thread 019, the identity tail). The rows are judged against
 * the tally a human would have made by hand — the same one that found "two dev-cores"
 * — so the cases here are the addresses that measurement actually turned up.
 */
describe("commit identity against the canon", () => {
  const roles = ["john", "curator", "dev-core", "reviewer-pr"];
  const one = (name: string, email: string, commits = 1): CommitIdentity => ({
    name,
    email,
    commits,
  });

  it("passes the three kinds the config can derive: a role, the machinery, GitHub", () => {
    const check = commitIdentityCheck({
      window: "the last 7 days",
      roles,
      identities: [
        one("dev-core", "dev-core@agents.invalid", 328),
        one("agent-protocol", MACHINERY_IDENTITY, 1061),
        one("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com", 1127),
        one("GitHub", "noreply@github.com", 140),
      ],
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("the last 7 days");
  });

  it("names a stray without failing the box — a person's own address is authorized elsewhere", () => {
    const check = commitIdentityCheck({
      window: "the last 7 days",
      roles,
      identities: [one("dev-core", "dev-core@agents.invalid", 9), one("ivan", "ivan@corp.ru", 5)],
      dictionary: { path: "docs/canon.md", present: true },
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("'ivan <ivan@corp.ru>' (5)");
    expect(check.detail).toContain("docs/canon.md");
  });

  it("says which strays wear a role's name — that is the shape the measurement found", () => {
    const check = commitIdentityCheck({
      window: "the last 7 days",
      roles,
      identities: [one("curator", "curator@lle.local", 8), one("ivan", "ivan@corp.ru", 500)],
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("1 of them wear a declared role's NAME");
    expect(check.detail).toContain("'curator <curator@lle.local>' (8)");
  });

  it("fails on a name inside the role namespace that answers to no declared role", () => {
    const check = commitIdentityCheck({
      window: "the whole history",
      roles,
      identities: [one("dev-mobile", "dev-mobile@agents.invalid", 3)],
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("dev-mobile@agents.invalid");
    expect(check.detail).toContain("no declared role");
  });

  it("counts the tail out loud instead of cutting the listing silently", () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      one(`box-${index}`, `box-${index}@hand.local`, 13 - index),
    );
    const check = commitIdentityCheck({ window: "the whole history", roles, identities: many });
    expect(check.detail).toContain("and 3 more");
  });

  it("is a fact, not a verdict, when git could not be read at all", () => {
    const check = commitIdentityCheck({
      window: "the last 7 days",
      roles,
      identities: [],
      error: "git refused to read the history",
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("not asked");
  });

  it("judges an address by case-folded email — git does not fold it, a reader does", () => {
    expect(identityVerdict({ email: "Dev-Core@Agents.Invalid", roles })).toBe("role");
    expect(identityVerdict({ email: "curator@lle.local", roles })).toBe("unrecognised");
    expect(identityVerdict({ email: MACHINERY_IDENTITY, roles })).toBe("machinery");
  });
});

/**
 * WHAT THIS BOX WILL SIGN WITH (thread 019, task 019.1). The half above measures the
 * history and therefore the consequence; these cases are the ones it cannot see — a box
 * that has committed nothing yet, and a box whose next commit is already wrong.
 */
describe("the effective signature of this box", () => {
  const roles = ["john", "curator", "dev-core", "reviewer-pr"];

  it("crosses an unset key: git derives an address from the hostname and says nothing", () => {
    const check = boxIdentityCheck({
      roles,
      places: [
        { place: "the checkout", email: null },
        { place: "the workspace of 'dev-core'", email: "dev-core@agents.invalid" },
      ],
      dictionary: { path: "docs/canon.md", present: true },
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("the checkout → 'nothing'");
    expect(check.detail).toContain("hostname");
    expect(check.detail).toContain("docs/canon.md");
    // The place that was already right is not dragged into the cross: the operator is
    // sent to the one config that needs a hand.
    expect(check.detail).not.toContain("the workspace of 'dev-core' → 'dev-core@agents.invalid'");
  });

  it("crosses a name inside the role namespace that answers to no declared role", () => {
    const check = boxIdentityCheck({
      roles,
      places: [{ place: "the checkout", email: "dev-mobile@agents.invalid" }],
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("dev-mobile@agents.invalid");
    expect(check.detail).toContain("somebody who does not exist");
  });

  it("names both crosses in one row when a box has both", () => {
    const check = boxIdentityCheck({
      roles,
      places: [
        { place: "the mail checkout", email: "   " },
        { place: "the checkout", email: "dev-mobile@agents.invalid" },
      ],
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("the mail checkout");
    expect(check.detail).toContain("the checkout → 'dev-mobile@agents.invalid'");
  });

  it("is a dot on an address it cannot derive — the dictionary authorizes a person's own", () => {
    const check = boxIdentityCheck({
      roles,
      places: [{ place: "the checkout", email: "ivan@corp.ru" }],
    });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("ivan@corp.ru");
    expect(check.detail).toContain("cannot tell it from a box signing by hand");
  });

  it("passes the machinery and the roles, and prints every place it asked", () => {
    const check = boxIdentityCheck({
      roles,
      places: [
        { place: "the checkout", email: MACHINERY_IDENTITY },
        { place: "the mail checkout", email: "curator@agents.invalid" },
        { place: "the workspace of 'dev-core'", email: "DEV-CORE@agents.invalid" },
      ],
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain(`the checkout → '${MACHINERY_IDENTITY}'`);
    expect(check.detail).toContain("the mail checkout → 'curator@agents.invalid'");
    expect(check.detail).toContain("the workspace of 'dev-core' → 'DEV-CORE@agents.invalid'");
  });

  it("says it was not asked rather than passing a box it never measured", () => {
    const check = boxIdentityCheck({ roles, places: [] });
    expect(check.status).toBe("info");
    expect(check.detail).toContain("not asked");
  });

  it("names a missing dictionary as a fact and keeps its verdict (080.5)", () => {
    const absent = { path: "docs/canon.md", present: false };
    const box = boxIdentityCheck({
      roles,
      places: [{ place: "the checkout", email: "ivan@corp.ru" }],
      dictionary: absent,
    });
    const history = commitIdentityCheck({
      window: "the last 7 days",
      roles,
      identities: [{ name: "ivan", email: "ivan@corp.ru", commits: 5 }],
      dictionary: absent,
    });
    // The verdict is about the SIGNATURE and does not move: a project that accepts the
    // protocol without copying the tool's docs is not a box committing wrong.
    expect(box.status).toBe("info");
    expect(history.status).toBe("info");
    for (const detail of [box.detail, history.detail]) {
      expect(detail).toContain("docs/canon.md");
      expect(detail).toContain("this repository does not have");
      expect(detail).toContain("travels with the tool");
    }
  });

  it("says the declared path and nothing more when the dictionary is there (080.5)", () => {
    const present = { path: "docs/canon.md", present: true };
    const withDictionary = boxIdentityCheck({
      roles,
      places: [{ place: "the checkout", email: "ivan@corp.ru" }],
      dictionary: present,
    });
    expect(withDictionary.status).toBe("info");
    expect(withDictionary.detail).toContain("docs/canon.md");
    expect(withDictionary.detail).not.toContain("does not have");
    expect(withDictionary.detail).not.toContain("has not declared");
    expect(dictionaryAt(present)).toBe("docs/canon.md");
  });

  it("names the FIELD to declare when the project declared no dictionary (080.9)", () => {
    // The third state, and the one the removed default used to hide: silence is not
    // 'docs/protocol-reference.md' — that file is one project's, and the tool travels.
    const box = boxIdentityCheck({
      roles,
      places: [{ place: "the checkout", email: "ivan@corp.ru" }],
    });
    const history = commitIdentityCheck({
      window: "the last 7 days",
      roles,
      identities: [{ name: "ivan", email: "ivan@corp.ru", commits: 5 }],
    });
    // A row that does not say WHAT to declare fixes nothing, so the field is named.
    for (const detail of [box.detail, history.detail]) {
      expect(detail).toContain(IDENTITY_DICTIONARY_UNDECLARED);
      expect(detail).toContain("identityDictionary");
      expect(detail).not.toContain("docs/protocol-reference.md");
    }
    // And it stays a FACT: a repository with no dictionary is a legitimate repository —
    // the verdict of these rows is about the box's signature alone.
    expect(box.status).toBe("info");
    expect(history.status).toBe("info");
    expect(dictionaryAt()).toBe(IDENTITY_DICTIONARY_UNDECLARED);
  });

  it("is the OTHER row: the two halves are told apart by name", () => {
    const history = commitIdentityCheck({ window: "the last 7 days", roles, identities: [] });
    const box = boxIdentityCheck({ roles, places: [] });
    expect(history.name).toBe("git: commit identity (history)");
    expect(box.name).toBe("git: commit identity (this box)");
  });
});
