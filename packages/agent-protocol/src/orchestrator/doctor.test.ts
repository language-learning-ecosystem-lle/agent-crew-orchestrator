import { describe, expect, it } from "vitest";
import {
  agentLiveCheck,
  doctorPassed,
  doctorSummary,
  gitChecks,
  instanceCheck,
  machineConfigCheck,
  mailPresenceCheck,
  maskedRemote,
  repositoryConfigCheck,
} from "./doctor.js";
import type { PreflightCheck } from "./preflight.js";

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
