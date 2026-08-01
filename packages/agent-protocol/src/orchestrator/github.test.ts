import { describe, expect, it } from "vitest";

import {
  deployKeyHint,
  githubSummary,
  hasHostEntry,
  keyStep,
  probeStep,
  readSshProbe,
  sshConfigBlock,
  sshConfigStep,
} from "./github.js";

describe("keyStep", () => {
  it("creates a pair the box does not have", () => {
    const step = keyStep({ path: "/home/a/.ssh/github", present: false, comment: "lle-agents" });
    expect(step.action).toBe("create");
    expect(step.detail).toContain("ed25519");
    expect(step.detail).toContain("lle-agents");
  });

  it("never regenerates an existing key and says how to rotate it", () => {
    const step = keyStep({ path: "/home/a/.ssh/github", present: true, comment: "lle-agents" });
    expect(step.action).toBe("keep");
    expect(step.detail).toContain("move it aside");
  });
});

describe("sshConfigBlock", () => {
  it("names the key and pins ssh to it", () => {
    const block = sshConfigBlock({ host: "github.com", key: "/home/a/.ssh/github" });
    expect(block).toContain("Host github.com");
    expect(block).toContain("IdentityFile /home/a/.ssh/github");
    // Without this line ssh offers every identity it holds and GitHub takes the first
    // one that fits — the box then pushes as somebody else with different rights.
    expect(block).toContain("IdentitiesOnly yes");
  });
});

describe("hasHostEntry", () => {
  it("finds the host by its Host line", () => {
    expect(hasHostEntry("Host github.com\n  User git\n", "github.com")).toBe(true);
  });

  it("finds it among several aliases on one line", () => {
    expect(hasHostEntry("Host gh github.com\n", "github.com")).toBe(true);
  });

  it("is not fooled by the host appearing as a value", () => {
    expect(hasHostEntry("Host work\n  HostName github.com\n", "github.com")).toBe(false);
  });

  it("reads an indented, differently-cased declaration", () => {
    expect(hasHostEntry("  host GitHub.com\n", "github.com")).toBe(true);
  });

  it("says nothing is there for an empty file", () => {
    expect(hasHostEntry("", "github.com")).toBe(false);
  });
});

describe("sshConfigStep", () => {
  const base = { path: "/home/a/.ssh/config", host: "github.com", key: "/home/a/.ssh/github" };

  it("creates the file when there is none", () => {
    const step = sshConfigStep({ ...base, present: false, hasEntry: false });
    expect(step.action).toBe("create");
    expect(step.detail).toContain("IdentitiesOnly yes");
  });

  it("appends a block to a file that says nothing about the host", () => {
    expect(sshConfigStep({ ...base, present: true, hasEntry: false }).action).toBe("set");
  });

  it("leaves an existing entry alone and says what to compare it with", () => {
    const step = sshConfigStep({ ...base, present: true, hasEntry: true });
    expect(step.action).toBe("keep");
    expect(step.detail).toContain("/home/a/.ssh/github");
    expect(step.detail).toContain("IdentitiesOnly yes");
  });
});

describe("deployKeyHint", () => {
  it("prints the public half with the four clicks", () => {
    const hint = deployKeyHint({ pub: "ssh-ed25519 AAAA… lle-agents\n", host: "github.com" });
    expect(hint).toContain("ssh-ed25519 AAAA… lle-agents");
    expect(hint).toContain("Deploy keys");
    expect(hint).toContain("Allow write access");
  });

  it("names the machine user as the multi-repo answer, not as a fork in the road", () => {
    const hint = deployKeyHint({ host: "github.com" });
    expect(hint).toContain("machine user");
    expect(hint).toContain("several repositories");
  });

  it("says where the public half will come from when there is no key yet", () => {
    expect(deployKeyHint({ host: "github.com" })).toContain("--write");
  });
});

describe("readSshProbe", () => {
  // The one thing every checklist written against this command gets wrong once: ssh
  // exits 1 on a working key. The verdict is read from the words, and the code is not
  // even an argument of the function.
  it("reads a deploy key by the repository GitHub names", () => {
    const probe = readSshProbe(
      "Hi language-learning-ecosystem-lle/language-learning-ecosystem! You've successfully authenticated, but GitHub does not provide shell access.",
    );
    expect(probe).toEqual({
      kind: "deploy-key",
      subject: "language-learning-ecosystem-lle/language-learning-ecosystem",
    });
  });

  it("carries write access when GitHub names it", () => {
    const probe = readSshProbe(
      "Hi org/repo! You've successfully authenticated with write access, but GitHub does not provide shell access.",
    );
    expect(probe).toEqual({ kind: "deploy-key", subject: "org/repo", write: true });
  });

  it("reads an account key by the login, which cannot hold a slash", () => {
    expect(
      readSshProbe(
        "Hi maysway! You've successfully authenticated, but GitHub does not provide shell access.",
      ),
    ).toEqual({ kind: "account", subject: "maysway" });
  });

  it("reads a refusal as a refusal", () => {
    expect(readSshProbe("git@github.com: Permission denied (publickey).").kind).toBe("denied");
  });

  it("calls anything else unreachable and carries what was said", () => {
    const probe = readSshProbe("ssh: Could not resolve hostname github.com");
    expect(probe.kind).toBe("unreachable");
    expect(probe).toHaveProperty("said", "ssh: Could not resolve hostname github.com");
  });
});

describe("probeStep", () => {
  it("reports a deploy key as the row an operator is after", () => {
    const step = probeStep({ kind: "deploy-key", subject: "org/repo", write: true }, "github.com");
    expect(step.action).toBe("keep");
    expect(step.detail).toContain("org/repo");
    expect(step.detail).toContain("write access");
    // The success that looks like a failure, said out loud in the row itself.
    expect(step.detail).toContain("exits 1");
  });

  it("names a deploy key without write access as the reason a push will be refused", () => {
    const step = probeStep({ kind: "deploy-key", subject: "org/repo" }, "github.com");
    expect(step.detail).toContain("Allow write access");
  });

  it("treats an account key as a mismatch worth explaining, not as success", () => {
    const step = probeStep({ kind: "account", subject: "maysway" }, "github.com");
    expect(step.detail).toContain("IdentitiesOnly");
  });

  it("makes a refusal a cross with the grant that is missing", () => {
    const step = probeStep({ kind: "denied" }, "github.com");
    expect(step.action).toBe("missing");
    expect(step.detail).toContain("Deploy keys");
  });

  it("carries ssh's own words when there was no answer", () => {
    const step = probeStep({ kind: "unreachable", said: "connection timed out" }, "github.com");
    expect(step.action).toBe("missing");
    expect(step.detail).toContain("connection timed out");
  });
});

describe("githubSummary", () => {
  it("promises nothing was done without --write, GitHub included", () => {
    const line = githubSummary({ steps: [], write: false, probed: false });
    expect(line).toContain("--write");
    expect(line).toContain("GitHub was not asked");
  });

  it("says the last row is GitHub's answer, not the command's", () => {
    expect(githubSummary({ steps: [], write: true, probed: true })).toContain(
      "GitHub's own answer",
    );
  });

  it("says out loud that a skipped probe proves nothing", () => {
    expect(githubSummary({ steps: [], write: true, probed: false })).toContain("--no-probe");
  });

  it("ends on the human's step when GitHub does not accept the key yet", () => {
    const line = githubSummary({
      steps: [{ name: "github: ssh -T", action: "missing", detail: "…" }],
      write: true,
      probed: true,
    });
    expect(line).toContain("add the deploy key above");
  });
});
