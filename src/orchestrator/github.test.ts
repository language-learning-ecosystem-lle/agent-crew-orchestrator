import { describe, expect, it } from "vitest";

import {
  deployKeyHint,
  githubSummary,
  hasHostEntry,
  hostRefusal,
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
    const block = sshConfigBlock({
      alias: "github.com",
      host: "github.com",
      key: "/home/a/.ssh/github",
    });
    expect(block).toContain("Host github.com");
    expect(block).toContain("IdentityFile /home/a/.ssh/github");
    // Without this line ssh offers every identity it holds and GitHub takes the first
    // one that fits — the box then pushes as somebody else with different rights.
    expect(block).toContain("IdentitiesOnly yes");
  });

  /**
   * THE CASE THAT LET THE DEFECT LIVE (thread 004). Every test of this function used to
   * pass `github.com` for both halves, where `HostName ${alias}` and `HostName ${host}`
   * produce identical bytes — the suite was green under either of the two possible
   * mistakes. The alias of a SECOND identity on one box is the case the flag exists for,
   * and it is the case where the two values differ.
   */
  it("puts the alias in Host and the GITHUB HOST in HostName when they differ", () => {
    const block = sshConfigBlock({
      alias: "github-crew",
      host: "github.com",
      key: "/home/a/.ssh/github-crew",
    });
    expect(block).toContain("Host github-crew");
    // Measured on `hetzner` before this was split: `HostName github-crew` gave
    // "Could not resolve hostname github-crew", exit code 2.
    expect(block).toContain("HostName github.com");
    expect(block).not.toContain("HostName github-crew");
    expect(block).toContain("IdentityFile /home/a/.ssh/github-crew");
  });

  it("keeps a GitHub Enterprise host in both lines when no alias asks otherwise", () => {
    const block = sshConfigBlock({
      alias: "github.example.com",
      host: "github.example.com",
      key: "/home/a/.ssh/github",
    });
    expect(block).toContain("Host github.example.com");
    expect(block).toContain("HostName github.example.com");
  });
});

/**
 * THE DOOR THAT SAYS WHAT TO TYPE INSTEAD (thread 004). Splitting the two values fixes
 * the block but not the keystroke that produced the defect — a human typed
 * `--host github-crew` meaning an alias. Under the split that argument is no longer a
 * silent wrong block, but it is still a claim that GitHub lives at `github-crew`, and a
 * refusal is only worth the exit it names.
 */
describe("hostRefusal", () => {
  it("passes the documented use and a GitHub Enterprise host", () => {
    expect(hostRefusal({ alias: "github.com", host: "github.com" })).toBeUndefined();
    expect(hostRefusal({ alias: "github-crew", host: "github.com" })).toBeUndefined();
    expect(hostRefusal({ alias: "ghe", host: "github.example.com" })).toBeUndefined();
  });

  it("refuses a --host with no dot and names BOTH ways out", () => {
    const said = hostRefusal({ alias: "github-crew", host: "github-crew" });
    expect(said).toContain("--host 'github-crew'");
    // The exit for the case that actually happened, with the value already in it…
    expect(said).toContain("--alias github-crew");
    // …and the exit for the other reading, so the refusal does not assume which one.
    expect(said).toContain("--host github.example.com");
  });

  it("refuses an alias that is several names, because a Host line takes a list", () => {
    const said = hostRefusal({ alias: "gh crew", host: "github.com" });
    expect(said).toContain("--alias 'gh crew'");
    expect(said).toContain("LIST");
  });

  it("refuses an empty alias rather than writing a bare 'Host' line", () => {
    expect(hostRefusal({ alias: "", host: "github.com" })).toContain("--alias");
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

  /**
   * The same property, now load-bearing (thread 004): a box with two identities holds two
   * blocks whose `HostName` is `github.com`, and asking about the second alias must not
   * be answered by the first one's host line.
   */
  it("does not read another identity's block as this alias's", () => {
    const config = "Host github.com\n  HostName github.com\n";
    expect(hasHostEntry(config, "github-crew")).toBe(false);
    expect(hasHostEntry(config, "github.com")).toBe(true);
  });

  it("reads an indented, differently-cased declaration", () => {
    expect(hasHostEntry("  host GitHub.com\n", "github.com")).toBe(true);
  });

  it("says nothing is there for an empty file", () => {
    expect(hasHostEntry("", "github.com")).toBe(false);
  });
});

describe("sshConfigStep", () => {
  const base = {
    path: "/home/a/.ssh/config",
    alias: "github.com",
    host: "github.com",
    key: "/home/a/.ssh/github",
  };

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

  /**
   * The row is the only place the operator can catch an alias aimed at the wrong host,
   * and a row that prints one of the two values cannot be checked against anything.
   */
  it("prints BOTH names in every tense when they differ", () => {
    const split = { ...base, alias: "github-crew" };
    for (const step of [
      sshConfigStep({ ...split, present: false, hasEntry: false }),
      sshConfigStep({ ...split, present: true, hasEntry: false }),
      sshConfigStep({ ...split, present: true, hasEntry: true }),
    ]) {
      expect(step.detail).toContain("github-crew");
      expect(step.detail).toContain("github.com");
    }
  });
});

describe("deployKeyHint", () => {
  it("prints the public half with the four clicks", () => {
    const hint = deployKeyHint({ pub: "ssh-ed25519 AAAA… lle-agents\n", alias: "github.com" });
    expect(hint).toContain("ssh-ed25519 AAAA… lle-agents");
    expect(hint).toContain("Deploy keys");
    expect(hint).toContain("Allow write access");
  });

  it("names the machine user as the multi-repo answer, not as a fork in the road", () => {
    const hint = deployKeyHint({ alias: "github.com" });
    expect(hint).toContain("machine user");
    expect(hint).toContain("several repositories");
  });

  it("says where the public half will come from when there is no key yet", () => {
    expect(deployKeyHint({ alias: "github.com" })).toContain("--write");
  });

  // The command it hands the operator has to be the one that tests THIS block — the
  // alias, not the host every other identity on the box also resolves to.
  it("hands over the probe typed against the alias", () => {
    expect(deployKeyHint({ alias: "github-crew" })).toContain("ssh -T git@github-crew");
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
