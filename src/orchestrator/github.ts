/**
 * THE BOX'S IDENTITY FOR GITHUB (thread 019, п.4 of the commissioning statement:
 * "`init github` — генерация ключа, печать pub с подсказкой, `~/.ssh/config`, `ssh -T`").
 *
 * `init` writes what this box knows about itself, `config set` changes one line of it,
 * `doctor` says whether it holds together. This is the one pump of the same evening that
 * creates material OUTSIDE the repository and outside both configs: a private key in
 * `~/.ssh`, a `Host` block beside it, and an access grant that only a human can give. On
 * `lle-agents` that cost three chat messages and a fork in the road; here it is one
 * command that ends in an answer from GitHub itself.
 *
 * THE FORM OF THE IDENTITY IS DECIDED, and the command is written under it rather than
 * offering a menu (john, 2026-08-01, msg of curator ~04:55Z): the box's key lives as a
 * REPOSITORY DEPLOY KEY with write access — the org policy that refused deploy keys on
 * 31.07 was lifted, and the key of `lle-agents` already sits there. No separate account
 * and no machine user is created. A machine user stays a named alternative for the day
 * this box serves several repositories, and it is named in the printed hint and in the
 * doc — as a sentence, not as a branch of code nobody has taken.
 *
 * THREE THINGS IT WILL NOT DO, each for a reason it can state:
 *
 *  - **It never overwrites a private key.** An existing key file is a `keep`, always. The
 *    key is trusted by hosts this command has never heard of, and a regenerated one
 *    revokes all of them silently — the failure would surface days later as "the daemon
 *    cannot push" with nothing in any log pointing here. Rotation is a human act, and the
 *    refusal says which file to move aside.
 *  - **It never grants itself access.** It prints the public half and the four clicks;
 *    adding the deploy key is the human's, because it is the only step in the whole
 *    commissioning that hands out power.
 *  - **It never reads the probe's EXIT CODE as the answer.** `ssh -T git@github.com`
 *    exits 1 on a perfectly good key — GitHub authenticates and then closes the session,
 *    because it grants no shell. A checklist that judged the code would report the one
 *    working configuration as broken. The verdict is read from what GitHub SAID, and the
 *    sentence it says names WHO the box authenticated as, which is the fact the operator
 *    is actually after.
 */

/** What one step of the identity decided — the vocabulary of `init` (see `init.ts`). */
import type { InitStep } from "./init.js";

/**
 * THE PRIVATE HALF. Ed25519 and not RSA: it is what GitHub recommends, what OpenSSH
 * generates by default since 8.x, and short enough that the public half is one line an
 * operator can read off a terminal without wrapping.
 */
export const keyStep = (input: {
  readonly path: string;
  readonly present: boolean;
  readonly comment: string;
}): InitStep =>
  input.present
    ? {
        name: "github: key",
        action: "keep",
        // The refusal to overwrite is stated where the operator meets it, with the way
        // out: this is the one file in the whole commissioning whose loss is not local.
        detail: `${input.path}, already there — never regenerated: hosts that trust this key are not known here; to rotate, move it aside by hand first`,
      }
    : {
        name: "github: key",
        action: "create",
        detail: `${input.path} — a new ed25519 pair, no passphrase (an unattended daemon can answer no prompt), comment '${input.comment}'`,
      };

/**
 * THE `Host` BLOCK — how `git@github.com` on this box is made to mean THIS key.
 *
 * `IdentitiesOnly yes` is the line that does the work and the line that is forgotten:
 * without it ssh offers every identity the agent holds, GitHub accepts the FIRST one it
 * recognises, and a box that looks configured pushes as somebody else's account. With a
 * deploy key the mistake is worse than cosmetic — the wrong identity has different rights
 * on a different set of repositories.
 */
export const sshConfigBlock = (input: { readonly host: string; readonly key: string }): string =>
  [
    `Host ${input.host}`,
    `  HostName ${input.host}`,
    "  User git",
    `  IdentityFile ${input.key}`,
    "  IdentitiesOnly yes",
  ].join("\n");

/** Whether `~/.ssh/config` already speaks about that host — by its `Host` line, not by luck. */
export const hasHostEntry = (config: string, host: string): boolean =>
  config
    .split("\n")
    .some((line) => /^\s*Host\s+(.*)$/i.test(line) && hostsOf(line).includes(host.toLowerCase()));

const hostsOf = (line: string): readonly string[] =>
  (/^\s*Host\s+(.*)$/i.exec(line)?.[1] ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

/**
 * WHAT TO DO WITH `~/.ssh/config`. An existing entry for the host is a `keep` and NOT a
 * rewrite, for the same reason `init` never overwrites a declared binary: the block may
 * be a deliberate one (a second key, a proxy, a port), and this file belongs to the human
 * whose home directory it is in. The step then says what to compare it against, so the
 * operator who does want the change can make it in one look.
 */
export const sshConfigStep = (input: {
  readonly path: string;
  readonly host: string;
  readonly key: string;
  readonly present: boolean;
  readonly hasEntry: boolean;
}): InitStep => {
  const name = "github: ssh config";
  if (!input.present) {
    return {
      name,
      action: "create",
      detail: `${input.path} — created with a 'Host ${input.host}' block pointing at ${input.key} (IdentitiesOnly yes: without it ssh offers every key it has and GitHub takes the first one that fits)`,
    };
  }
  return input.hasEntry
    ? {
        name,
        action: "keep",
        detail: `${input.path} already speaks about '${input.host}' — left exactly as it is; check by hand that it names ${input.key} and 'IdentitiesOnly yes'`,
      }
    : {
        name,
        action: "set",
        detail: `${input.path} — a 'Host ${input.host}' block appended, pointing at ${input.key}`,
      };
};

/**
 * THE FOUR CLICKS, WITH THE PUBLIC HALF. Printed rather than done: this is the step that
 * grants power, and the only participant allowed to grant it is the human reading this.
 */
export const deployKeyHint = (input: { readonly pub?: string; readonly host: string }): string => {
  const key =
    input.pub === undefined
      ? "(the public half is printed once the key exists — run this with --write)"
      : input.pub.trim();
  return [
    "github: add this public half as a DEPLOY KEY of the repository, with write access:",
    "",
    key,
    "",
    `  repository → Settings → Deploy keys → Add deploy key → paste → tick 'Allow write access'`,
    "  the form is decided (john, 2026-08-01): a deploy key of this repository, not a separate",
    "  account and not a machine user — a machine user is the answer only when one box serves",
    "  several repositories, since a deploy key belongs to exactly one",
    `  then: ssh -T git@${input.host} — GitHub answers with the name of what it let in`,
  ].join("\n");
};

/** What GitHub said when asked who this box is. */
export type SshProbe =
  /** A deploy key: GitHub names the REPOSITORY it opens, and grants no shell. */
  | { readonly kind: "deploy-key"; readonly subject: string; readonly write?: boolean }
  /** An account key: GitHub names the LOGIN. */
  | { readonly kind: "account"; readonly subject: string }
  /** Reached GitHub, and it recognised nothing this box offered. */
  | { readonly kind: "denied" }
  /** Did not get an answer at all — no network, wrong host, ssh missing. */
  | { readonly kind: "unreachable"; readonly said: string };

/**
 * THE PROBE, READ FROM WHAT WAS SAID. The exit code is deliberately not an argument of
 * this function: `ssh -T git@github.com` exits 1 on success (authenticated, then refused
 * a shell), and every checklist that has ever been written against that command has got
 * this backwards once. The answers, verbatim:
 *
 *   "Hi maysway! You've successfully authenticated, but GitHub does not provide shell access."
 *   "Hi org/repo! You've successfully authenticated, but GitHub does not provide shell access."
 *
 * The second form is a deploy key, and the subject is the repository — which is exactly
 * the fact `doctor` and the operator want: not "a key works", but "the key that works
 * opens THIS repository".
 */
export const readSshProbe = (said: string): SshProbe => {
  const authenticated = /Hi\s+([^!]+)!\s*You've successfully authenticated/i.exec(said);
  if (authenticated !== null) {
    const subject = (authenticated[1] as string).trim();
    // A deploy key's subject is a repository — 'owner/repo'; an account's is a login,
    // and a login cannot hold a slash. The distinction is in GitHub's own words.
    if (subject.includes("/")) {
      const write = /write access/i.test(said);
      return { kind: "deploy-key", subject, ...(write ? { write: true } : {}) };
    }
    return { kind: "account", subject };
  }
  if (/Permission denied|Too many authentication failures/i.test(said)) return { kind: "denied" };
  return { kind: "unreachable", said: said.trim() };
};

/** The probe as a row of the same checklist, so it reads beside the other three. */
export const probeStep = (probe: SshProbe, host: string): InitStep => {
  const name = "github: ssh -T";
  if (probe.kind === "deploy-key") {
    return {
      name,
      action: "keep",
      detail: `authenticated as a deploy key of '${probe.subject}'${probe.write === true ? " with write access" : " — GitHub did not name write access; if a push is refused, the 'Allow write access' box is the reason"} (ssh exits 1 here and that is success: GitHub grants no shell)`,
    };
  }
  if (probe.kind === "account") {
    return {
      name,
      action: "keep",
      detail: `authenticated as the account '${probe.subject}' — that is an account key, not the deploy key this box was commissioned with; check 'IdentitiesOnly yes' in the Host block, or ssh is offering another key from the agent`,
    };
  }
  if (probe.kind === "denied") {
    return {
      name,
      action: "missing",
      detail: `GitHub refused every key offered — the public half above is not on the repository yet (Settings → Deploy keys), or the Host block points at another file`,
    };
  }
  return {
    name,
    action: "missing",
    detail: `no answer from git@${host} — ${probe.said === "" ? "ssh said nothing at all" : probe.said}`,
  };
};

/**
 * THE ONE LINE THAT SAYS WHAT HAPPENED, in the two tenses the rest of the machine-local
 * commands use. The plan is silent about the probe on purpose and says so: asking GitHub
 * who this box is before the key exists answers a question about the box that WAS.
 */
export const githubSummary = (input: {
  readonly steps: readonly InitStep[];
  readonly write: boolean;
  readonly probed: boolean;
}): string => {
  const blocked = input.steps.filter((step) => step.action === "missing");
  if (input.write && blocked.length > 0) {
    return `init github: the identity is on disk and GitHub does not accept it yet — ${blocked
      .map((step) => step.name)
      .join(", ")}; add the deploy key above, then run this again`;
  }
  if (!input.write) {
    return "init github: this is the plan — no key was generated, ~/.ssh was not touched and GitHub was not asked anything (--write does it)";
  }
  return input.probed
    ? "init github: done — the last row is GitHub's own answer, not this command's belief"
    : "init github: done — the identity is on disk; the probe was not run (--no-probe), so nothing here says GitHub accepts it";
};
