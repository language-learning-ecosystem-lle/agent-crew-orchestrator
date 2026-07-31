/**
 * DOCTOR — is THIS BOX ready to raise roles, answered by one command (thread 019,
 * the operator tail: "the commissioning of a box is CLI commands, not a
 * correspondence with curator").
 *
 * The measurement behind it: bringing the VPS `lle-agents` into service took an
 * evening and about a dozen hand steps typed out of a chat. Every step was a
 * question with a yes/no answer — is the binary there, does the token still work, can
 * this box push, is the mail checkout fetched — and not one of them was asked by
 * anything but a human's memory. A checklist a human runs from memory is the class of
 * defect this package exists against; `preflight` already made that argument for a
 * RUN, and this is the same argument for a BOX.
 *
 * WHY IT IS NOT `preflight`, WHICH LOOKS ALIKE. Preflight answers "may this run
 * start", and it is answered on the way into a launch — so everything it asks has to
 * be cheap, local and safe to ask on every tick of the daemon. Doctor answers "has
 * this box been commissioned", and that question is asked by a human, twice in the
 * life of a machine: the day it is set up and the day something has stopped working.
 * It may therefore do what preflight must never do — reach the network, spend an
 * agent call, ask the remote for permission to write.
 *
 * THE THREE STATUSES ARE PREFLIGHT'S, and deliberately the same vocabulary (R12): a
 * tick is a comparison that MATCHED, a dot is a fact nobody promised anything about,
 * a cross is what stops the box being ready. The temptation here is to tick a fact
 * ("the config file exists") — and a ticked fact is read as a checked expectation,
 * which is how `✓ working tree` once blessed two runs that started from the wrong
 * branch.
 *
 * WHAT IS A CROSS AND WHAT IS A DOT is the whole judgement of this module, so it is
 * stated once, here: a cross is a state in which the CIRCUIT OF THIS PROJECT would do
 * something wrong or nothing at all on this box — no binary, a dead token, a mail
 * checkout the daemon refuses to read. A dot is a state that is merely not the
 * commissioned one: a laptop that never raises anybody is a legitimate machine, and
 * telling its operator that their box is broken would teach them to read past the
 * crosses.
 *
 * This module is the pure core — facts in, rows out. Every probe (spawning the agent,
 * talking to git, reading the mail checkout) lives in the CLI, where the effects are.
 */

import type { CheckStatus, PreflightCheck } from "./preflight.js";

/**
 * WHAT ONE PROBE CAME BACK WITH. `ok` is the verdict, `detail` is what it learned —
 * the version it printed, the remote's own refusal, git's own words. The words of the
 * thing that refused are carried out verbatim rather than summarised: "permission
 * denied" from the remote and "could not resolve host" are different evenings.
 */
export type DoctorProbe = {
  readonly ok: boolean;
  readonly detail: string;
};

/**
 * A probe that was NOT RUN, and why. It is a state of its own rather than a failure
 * or a pass, because the two readings it would otherwise get are both wrong: `--offline`
 * turning a row red would make the flag useless, and turning it green would report a
 * live token on a box that was never asked for one.
 */
export type DoctorSkipped = { readonly skipped: string };

export type DoctorOutcome = DoctorProbe | DoctorSkipped;

const isSkipped = (outcome: DoctorOutcome): outcome is DoctorSkipped => "skipped" in outcome;

const verdict = (name: string, outcome: DoctorOutcome): PreflightCheck =>
  isSkipped(outcome)
    ? { name, status: "info", detail: `not asked — ${outcome.skipped}` }
    : { name, status: outcome.ok ? "ok" : "fail", detail: outcome.detail };

/**
 * The repository config: valid, and read AT A REF like everywhere else. The row is the
 * existing `config check` reduced to one line — doctor does not re-implement that
 * judgement, it hosts it, so a rule added there appears here without being copied.
 */
export const repositoryConfigCheck = (input: {
  readonly path: string;
  readonly ref: string;
  readonly roles: number;
  readonly issues: readonly string[];
}): PreflightCheck =>
  input.issues.length === 0
    ? {
        name: "config: repository",
        status: "ok",
        detail: `'${input.path}' at ${input.ref} — ${input.roles} roles, holds together`,
      }
    : {
        name: "config: repository",
        status: "fail",
        detail: `'${input.path}' at ${input.ref}: ${input.issues.join("; ")}`,
      };

/**
 * The machine config (R14). ABSENCE IS A DOT, NOT A CROSS, and that is the same
 * decision `loadLocalConfig` already makes: a box whose agent is simply on `PATH` and
 * who raises nobody has nothing to say in that file. An unreadable or invalid one IS a
 * cross — it was written, so somebody meant it to be read.
 */
export const machineConfigCheck = (input: {
  readonly path: string;
  readonly found: boolean;
  readonly error?: string;
  readonly summary?: string;
}): PreflightCheck => {
  if (input.error !== undefined) {
    return { name: "config: machine", status: "fail", detail: input.error };
  }
  if (!input.found) {
    return {
      name: "config: machine",
      status: "info",
      detail: `${input.path} — absent (the binaries are taken from PATH; a box that raises roles needs it)`,
    };
  }
  return {
    name: "config: machine",
    status: "ok",
    detail: input.summary ?? `${input.path} — valid`,
  };
};

/**
 * WHICH INSTANCE THIS BOX IS (R13) — the join between the topology in the repository
 * and the name in the machine config.
 *
 * Four states, and the split between the last two is curator's, from the statement:
 * a name the repository does not declare is NOT an error, it is a bench — a machine
 * that runs the CLI and raises nobody. That is a normal way to use this package
 * (every developer's checkout is one), and it earns a dot with the consequence spelt
 * out. A box with NO name while the repository declares instances is a cross: the
 * daemon refuses to raise anything there and says so only when somebody starts it.
 */
export const instanceCheck = (input: {
  readonly instance?: string;
  readonly declared: readonly string[];
  readonly roles?: readonly string[];
  readonly localConfigPath: string;
}): PreflightCheck => {
  const name = "config: instance";
  if (input.declared.length === 0) {
    return input.instance === undefined
      ? {
          name,
          status: "info",
          detail: "the repository declares no instances — one box, every role",
        }
      : {
          name,
          status: "fail",
          detail: `this box calls itself '${input.instance}' ('${input.localConfigPath}'), and the repository declares no instances — the name has nothing to join to`,
        };
  }
  if (input.instance === undefined) {
    return {
      name,
      status: "fail",
      detail: `this box has no name while the repository declares ${input.declared.map((id) => `'${id}'`).join(", ")} — add "instance": "<id>" to '${input.localConfigPath}', or it raises nobody`,
    };
  }
  if (!input.declared.includes(input.instance)) {
    return {
      name,
      status: "info",
      detail: `'${input.instance}' is not declared in the repository (it knows ${input.declared.map((id) => `'${id}'`).join(", ")}) — a bench: it raises no role of this project`,
    };
  }
  const roles = input.roles ?? [];
  return {
    name,
    status: "ok",
    detail: `'${input.instance}' — ${roles.length === 0 ? "no roles assigned to it" : `raises ${roles.join(", ")}`}`,
  };
};

/**
 * THE MOMENT OF TRUTH OF THE EVENING THIS COMMAND COMES FROM: does the agent, spawned
 * exactly as the circuit spawns it, answer a headless prompt on this box?
 *
 * Everything else about an agent is inferable from a file — the path, the version, the
 * flags. Whether the credentials in this operator's home directory are still good for
 * a `-p` run is inferable from nothing at all, and it is the failure that looks most
 * like success from the outside: the daemon raises sessions, each one dies on its
 * first call, the journal fills with attempts. So it is asked HERE, once, by a human
 * who is watching.
 *
 * The probe's output is not printed. It is an agent's answer to a throwaway prompt,
 * and the only thing doctor takes from it is that there was one.
 */
export const agentLiveCheck = (input: {
  readonly worker: string;
  readonly outcome: DoctorOutcome;
}): PreflightCheck => verdict(`agent: headless run (${input.worker})`, input.outcome);

/**
 * THE REMOTE URL AS IT MAY BE PRINTED. A checklist whose whole purpose is to be read
 * by a human — and pasted into a chat or a ticket — must not carry a credential, and
 * an automation clone carries one right in the url (`https://x-access-token:<token>@…`
 * is the ordinary form; a bare `https://<token>@…` is the same thing without a name).
 * Rule 10 of the project says keys are masked in diagnostics, so the masking is done
 * HERE, where the row is built, rather than by the caller who happens to remember.
 *
 * An ssh remote is left alone on purpose: ssh authenticates by key, so its `git@` is a
 * login and not a secret — masking it would hide the one part of the url an operator
 * reads the row for. The scp-like form (`git@host:path`) has no scheme and no place to
 * put a password at all, so it is returned untouched.
 */
export const maskedRemote = (url: string): string => {
  const parts = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/@]+)@([^/]*)(.*)$/.exec(url);
  if (parts === null) return url;
  const [, scheme = "", userinfo = "", host = "", rest = ""] = parts;
  if (["ssh", "git+ssh", "git"].includes(scheme.toLowerCase())) return url;
  const at = userinfo.indexOf(":");
  // With a password, the user half stays: 'x-access-token' names the KIND of credential
  // and is worth reading. Without one, the whole userinfo goes — a lone token sits
  // exactly there, and a username indistinguishable from a secret is treated as one.
  const masked = at === -1 ? "***" : `${userinfo.slice(0, at)}:***`;
  return `${scheme}://${masked}@${host}${rest}`;
};

/** The three answers git owes a box that is supposed to work unattended in a repository. */
export const gitChecks = (input: {
  readonly origin: string | null;
  readonly fetch: DoctorOutcome;
  readonly push: DoctorOutcome;
}): readonly PreflightCheck[] => [
  input.origin === null
    ? {
        name: "git: origin",
        status: "fail" as CheckStatus,
        detail: "the repository has no 'origin' remote — the circuit reads and writes through it",
      }
    : { name: "git: origin", status: "info" as CheckStatus, detail: maskedRemote(input.origin) },
  verdict("git: fetch", input.fetch),
  // WHY A WRITE IS PROBED AT ALL, and why a dry run is the honest form of it: every
  // delivery this package makes ends in a push, and a box that can read and not write
  // fails at the LAST step of the first message a role writes — after the work. A
  // `--dry-run` push performs everything but the update, so a remote that will refuse
  // the write refuses it here, in the operator's own words, with nothing created.
  verdict("git: write access (dry-run push)", input.push),
];

/**
 * The mail checkout, as a box question rather than a run question: is it there at all.
 * Its FRESHNESS is judged by `mailCheckoutVerdict`, which the caller passes straight
 * through — the daemon's refusal and doctor's row must be the same sentence, or a
 * green doctor would sit next to a daemon that raises nobody.
 */
export const mailPresenceCheck = (input: {
  readonly path: string;
  readonly present: boolean;
}): PreflightCheck =>
  input.present
    ? { name: "mail: checkout", status: "ok", detail: input.path }
    : {
        name: "mail: checkout",
        status: "fail",
        detail: `'${input.path}' is not there — the circuit reads its mail from disk; create the worktree (with a fetch: a checkout created without one reads as "never pulled")`,
      };

/**
 * THE ONE LINE THAT IS THE ANSWER. "doctor is green" is the acceptance criterion of a
 * commissioned box in the statement, so the command has to end in something that IS
 * green or is not — a reader who has to add up thirteen rows will read them the way
 * they read a preflight nobody failed.
 */
export const doctorSummary = (checks: readonly PreflightCheck[]): string => {
  const failed = checks.filter((check) => check.status === "fail");
  const passed = checks.filter((check) => check.status === "ok").length;
  const facts = checks.filter((check) => check.status === "info").length;
  if (failed.length === 0) {
    return `doctor: green — ${passed} checks passed, ${facts} facts, nothing failed`;
  }
  return `doctor: ${failed.length} of ${checks.length} failed — ${failed
    .map((check) => check.name)
    .join(", ")}`;
};

/** Nothing failed. A fact was never a verdict and cannot refuse one (R12). */
export const doctorPassed = (checks: readonly PreflightCheck[]): boolean =>
  checks.every((check) => check.status !== "fail");
