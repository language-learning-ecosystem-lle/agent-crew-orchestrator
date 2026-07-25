/**
 * Preflight — the checks made BEFORE the circuit takes a lease. Step S8
 * (thread 012).
 *
 * The rule curator named after the third case of one class within a day: **what a
 * human is obliged to remember before a run, the machine either does itself or
 * loudly refuses.** The paths lived in correspondence (S6), the permissions
 * nowhere (S7), the environment and the freshness of the mail in chat hints. Each
 * time the price is the same: the circuit looks like it works and works wrongly.
 *
 * THREE THINGS THAT MUST NOT BE LEFT TO HUMAN MEMORY:
 *
 *  1. **The agent binary.** Its absence would surface as a fact of the spawn —
 *     with the lease ALREADY taken: the journal would show an attempt that never
 *     happened.
 *  2. **Freshness of the mail checkout.** The daemon reads mail from disk. A stale
 *     checkout means "read yesterday's mail and silently worked on it" — in
 *     unattended mode that is not a failure but WRONG WORK, the worst outcome
 *     there is: there is a result, it is incorrect, and nobody sees it.
 *  3. **The environment through the child's eyes.** We print what the child
 *     process will actually inherit rather than what "ought to be": the node
 *     version of the agent's shell and of the daemon are different things, and the
 *     mismatch has already cost this project a separate lesson.
 *
 * TOOLCHAIN MANAGEMENT IS NOT HANDED TO THE PACKAGE (`nvm use` and the like) —
 * that is knowledge about the project, and the package has none of it. The project
 * declares an environment preamble in the config (`orchestrator.env`), the package
 * applies it and SHOWS what came out.
 *
 * This module is the pure core: facts in, verdicts out. The probes (git, `which`,
 * running `node --version`) live in the CLI, where they belong.
 */

/**
 * THREE OUTCOMES, NOT TWO (R12, thread 016). `ok` is a verdict — something was
 * compared against an expectation and matched; `info` is a FACT nobody promised
 * anything about; `fail` stops the circuit.
 *
 * The split was paid for twice: preflight printed `✓ working tree:
 * agent-protocol/tails-readme` before two runs that then started work from the
 * previous package's branch. The line was true and the tick was a lie — a check
 * with no expectation to compare against cannot pass, it can only report. A tick
 * on a line nobody verified is worse than no line: it is read as "checked".
 */
export type CheckStatus = "ok" | "info" | "fail";

export type PreflightCheck = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

/** The observable state of the mail checkout — what the CLI asks git about. */
export type CheckoutFacts = {
  /** The branch the checkout sits on. */
  readonly branch: string;
  /** The mail branch from the config. */
  readonly expectedBranch: string;
  /** There are unsaved changes (including uncommitted messages). */
  readonly dirty: boolean;
  /** Commits behind origin AFTER the update attempt. */
  readonly behind: number;
  /** Local commits that origin does not have. */
  readonly ahead: number;
};

/**
 * The verdict on the mail checkout. A refusal rather than an auto-repair wherever
 * repairing would mean destroying someone else's work: a dirty tree may well be a
 * message a role is writing right now, and `reset --hard` would wipe it silently.
 */
export const mailCheckoutVerdict = (facts: CheckoutFacts): PreflightCheck => {
  const name = "mail: checkout freshness";
  if (facts.branch !== facts.expectedBranch) {
    return {
      name,
      status: "fail",
      detail: `the checkout sits on '${facts.branch}', while the mail lives in '${facts.expectedBranch}'`,
    };
  }
  if (facts.dirty) {
    return {
      name,
      status: "fail",
      detail:
        "unsaved changes in the checkout — leaving them alone: a role may be writing a message",
    };
  }
  if (facts.ahead > 0) {
    return {
      name,
      status: "fail",
      detail: `${facts.ahead} unpushed commits in the checkout — the circuit would read mail nobody else has`,
    };
  }
  if (facts.behind > 0) {
    return {
      name,
      status: "fail",
      detail: `the checkout is ${facts.behind} commits behind origin and did not update — working on yesterday's mail is worse than refusing`,
    };
  }
  return { name, status: "ok", detail: `on '${facts.branch}', matches origin` };
};

/** The verdict on the agent binary: before the lease, not as a fact of a failed spawn. */
export const agentBinaryVerdict = (exec: string, resolved: string | null): PreflightCheck => ({
  name: "agent: binary",
  status: resolved === null ? "fail" : "ok",
  detail:
    resolved === null
      ? `'${exec}' not found in the child process PATH — the spawn would fail with the lease already taken`
      : resolved,
});

/**
 * The environment: we show WHAT THE CHILD WILL INHERIT. It is `info` and never
 * `ok` — the package does not know which node version is "right" for someone
 * else's project, so there is nothing here it could pass or fail.
 */
export const environmentVerdict = (input: {
  readonly nodeVersion: string | null;
  readonly appliedKeys: readonly string[];
}): PreflightCheck => {
  const preamble =
    input.appliedKeys.length === 0
      ? "no environment preamble"
      : `preamble: ${input.appliedKeys.join(", ")}`;
  return {
    name: "environment: through the child's eyes",
    status: "info",
    detail: `node ${input.nodeVersion ?? "not resolved"} · ${preamble}`,
  };
};

/** Only `fail` stops the circuit: a fact that was never a verdict cannot refuse one. */
export const preflightPassed = (checks: readonly PreflightCheck[]): boolean =>
  checks.every((check) => check.status !== "fail");

/** The marks: a tick is a passed COMPARISON, a dot is a fact, a cross stops the run. */
const MARK: Record<CheckStatus, string> = { ok: "✓", info: "·", fail: "✗" };

/**
 * The display. Printed IN FULL always, not only on failure: "what has been
 * checked" is in itself the answer to "what I no longer have to remember".
 */
export const renderPreflight = (checks: readonly PreflightCheck[]): string =>
  checks.map((check) => `${MARK[check.status]} ${check.name}: ${check.detail}`).join("\n");

/**
 * The verdict on the WORKING repository the session lands in. The fact is printed
 * always; a refusal only if the project declared an expected branch. The package
 * does not know which branch is "right" for someone else's repository and will not
 * invent one.
 *
 * WITH NO EXPECTATION DECLARED THE LINE IS `info`, NOT `ok` (R12). Twice a run
 * started from the previous package's branch under a tick that said `✓ working
 * tree: agent-protocol/tails-readme` — the branch name was right there and read as
 * confirmation. Nothing had been compared: the project had declared nothing to
 * compare against. Now the mark says which of the two it is, and a project that
 * wants the check to bite writes `orchestrator.workdir.branch`.
 */
export const workdirVerdict = (input: {
  readonly branch: string;
  readonly dirty: boolean;
  readonly expectedBranch?: string;
}): PreflightCheck => {
  const state = `${input.branch}${input.dirty ? ", has unsaved changes" : ""}`;
  if (input.expectedBranch === undefined) {
    return {
      name: "working tree",
      status: "info",
      detail: `${state} — no expected branch declared (orchestrator.workdir.branch), nothing was compared`,
    };
  }
  if (input.branch !== input.expectedBranch) {
    return {
      name: "working tree",
      status: "fail",
      detail: `the session would land on '${input.branch}', while the project expects '${input.expectedBranch}'`,
    };
  }
  return { name: "working tree", status: "ok", detail: `${state}, matches the expected branch` };
};
