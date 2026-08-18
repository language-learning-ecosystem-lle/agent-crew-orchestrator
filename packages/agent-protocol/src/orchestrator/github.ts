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
 * THE `Host` BLOCK — how `git@<alias>` on this box is made to mean THIS key.
 *
 * TWO VALUES, NOT ONE (thread 004). `Host` is the NAME THIS BOX TYPES — the alias in
 * `git@<alias>` and in the remote of a checkout; `HostName` is WHERE THAT NAME RESOLVES —
 * the GitHub host itself. Until 2026-08-18 both lines carried the alias, which is correct
 * by accident whenever the two coincide (`--host github.com`, the only documented use)
 * and unresolvable in the one case the flag exists for — a SECOND identity on one box,
 * where the alias is deliberately not a host. Measured on `hetzner`: `Could not resolve
 * hostname github-crew`, exit code 2, from a block this function had just written.
 *
 * `IdentitiesOnly yes` is the line that does the work and the line that is forgotten:
 * without it ssh offers every identity the agent holds, GitHub accepts the FIRST one it
 * recognises, and a box that looks configured pushes as somebody else's account. With a
 * deploy key the mistake is worse than cosmetic — the wrong identity has different rights
 * on a different set of repositories.
 */
export const sshConfigBlock = (input: {
  readonly alias: string;
  readonly host: string;
  readonly key: string;
}): string =>
  [
    `Host ${input.alias}`,
    `  HostName ${input.host}`,
    "  User git",
    `  IdentityFile ${input.key}`,
    "  IdentitiesOnly yes",
  ].join("\n");

/**
 * WHAT THIS COMMAND REFUSES TO WRITE, and why it refuses instead of guessing.
 *
 * The defect above was typed as `--host github-crew` by a human who meant an alias, and
 * the command silently produced a block ssh cannot use. Splitting the two values fixes
 * the block but not that keystroke: `--host github-crew` still means "GitHub lives at
 * `github-crew`", which resolves nowhere. A name with no dot is not a host on any network
 * this command can reach, so it is refused BY NAME, and the refusal names BOTH exits —
 * the alias flag for the identity case, a full domain for a GitHub Enterprise host.
 *
 * The alias is checked for the one thing that would corrupt the file rather than the
 * lookup: `Host` takes a whitespace-separated list, so an alias holding a space silently
 * declares two of them.
 */
export const hostRefusal = (input: {
  readonly alias: string;
  readonly host: string;
}): string | undefined => {
  if (!input.host.includes(".") || /\s/.test(input.host))
    return `--host '${input.host}' is not a host of GitHub: a name with no dot resolves nowhere, and 'HostName ${input.host}' is a block ssh refuses to use. If that is this box's LOCAL ALIAS (a second identity on one box), it is '--alias ${input.host}' and the host stays '--host github.com'; if it really is a GitHub Enterprise host, name it in full ('--host github.example.com')`;
  if (/\s/.test(input.alias) || input.alias === "")
    return `--alias '${input.alias}' is not one name: an ssh 'Host' line takes a whitespace-separated LIST, so this would declare several aliases and pin the key to each of them. Name one word — the alias goes into 'git@<alias>' and into the remote of a checkout`;
  return undefined;
};

/**
 * Whether `~/.ssh/config` already speaks about that ALIAS — by its `Host` line, not by
 * luck. The question is asked of the alias and not of the host on purpose: the file may
 * legitimately hold three blocks whose `HostName` is `github.com` and whose aliases are
 * three different identities, and matching on the host would read the first of them as
 * "this one is already there".
 */
export const hasHostEntry = (config: string, alias: string): boolean =>
  config
    .split("\n")
    .some((line) => /^\s*Host\s+(.*)$/i.test(line) && hostsOf(line).includes(alias.toLowerCase()));

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
  readonly alias: string;
  readonly host: string;
  readonly key: string;
  readonly present: boolean;
  readonly hasEntry: boolean;
}): InitStep => {
  const name = "github: ssh config";
  // Both values in the row, always — the operator reading the checklist is the only
  // person who can catch an alias pointed at the wrong host, and they cannot catch what
  // the row does not print.
  const block = `'Host ${input.alias}' → 'HostName ${input.host}'`;
  if (!input.present) {
    return {
      name,
      action: "create",
      detail: `${input.path} — created with a ${block} block pointing at ${input.key} (IdentitiesOnly yes: without it ssh offers every key it has and GitHub takes the first one that fits)`,
    };
  }
  return input.hasEntry
    ? {
        name,
        action: "keep",
        detail: `${input.path} already speaks about '${input.alias}' — left exactly as it is; check by hand that it names ${input.key}, 'HostName ${input.host}' and 'IdentitiesOnly yes'`,
      }
    : {
        name,
        action: "set",
        detail: `${input.path} — a ${block} block appended, pointing at ${input.key}`,
      };
};

/**
 * THE FOUR CLICKS, WITH THE PUBLIC HALF. Printed rather than done: this is the step that
 * grants power, and the only participant allowed to grant it is the human reading this.
 */
export const deployKeyHint = (input: { readonly pub?: string; readonly alias: string }): string => {
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
    `  then: ssh -T git@${input.alias} — GitHub answers with the name of what it let in`,
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

/**
 * The probe as a row of the same checklist, so it reads beside the other three. It is
 * asked of the ALIAS, because the alias is what the block just written defines and what
 * every later `git push` will type: probing the host directly would answer for whatever
 * identity ssh picks for `github.com`, which is the question this command is not asking.
 */
export const probeStep = (probe: SshProbe, alias: string): InitStep => {
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
    detail: `no answer from git@${alias} — ${probe.said === "" ? "ssh said nothing at all" : probe.said}`,
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
