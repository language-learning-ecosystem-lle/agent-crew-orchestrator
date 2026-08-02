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
 * WHO SIGNED THE COMMITS OF THIS REPOSITORY (thread 019, the identity tail).
 *
 * The measurement behind it: the GitHub interface showed "two dev-cores", and a tally
 * over the whole history explained why — beside the canonical `<role>@agents.invalid`
 * there were `dev-core@lle.local`, `@agents.local`, `@agent.local`, `@local` and a
 * personal address, each a box or an epoch where the signing was set by hand and set
 * differently. Nothing breaks from it, which is exactly why nobody notices: the
 * identity of a commit is read months later, by a human trying to tell a session's
 * work from the machinery's, and by then the wrong name is history and history is not
 * rewritten. So it is asked while it is still cheap to fix — on the box, by doctor.
 *
 * WHAT IS THE CANON, and why most of it is DERIVED rather than listed: the roles of the
 * project are in the config, so `<role>@agents.invalid` needs no dictionary; the
 * machinery signs `orchestrator@agents.invalid` (a deliberate second identity, not a
 * defect — "session vs orchestrator" is worth telling apart); GitHub's own writes come
 * from `@users.noreply.github.com` and `noreply@github.com`. Everything else this
 * package CANNOT judge — a human's own named address is authorized by a project, not
 * by a schema — so it is NAMED and handed to the reader, together with the dictionary
 * that says which of them a project has blessed.
 *
 * WHY THE STRAY IS A DOT AND THE IMPOSTOR IS A CROSS. A dot is the module's word for a
 * fact nobody promised anything about, and an unrecognised address is precisely that:
 * the circuit works, and the address may be a legitimate hand. An address inside
 * `@agents.invalid` that is NOT a declared role is the other thing — that namespace
 * exists so a commit can be read as "this role did it", and a name in it that no role
 * answers to means some box is signing as somebody who does not exist.
 */
export type CommitIdentity = {
  readonly name: string;
  readonly email: string;
  readonly commits: number;
};

/** The namespace the circuit signs in: a role, or the machinery itself. */
export const ROLE_IDENTITY_DOMAIN = "agents.invalid";
export const MACHINERY_IDENTITY = `orchestrator@${ROLE_IDENTITY_DOMAIN}`;

export type IdentityVerdict = "role" | "machinery" | "github" | "impostor" | "unrecognised";

/**
 * One address against the canon. Case is folded because git does not: the same box
 * spelling its email with a capital would otherwise read as a second identity.
 */
export const identityVerdict = (input: {
  readonly email: string;
  readonly roles: readonly string[];
}): IdentityVerdict => {
  const email = input.email.trim().toLowerCase();
  if (email === MACHINERY_IDENTITY) return "machinery";
  if (email.endsWith(`@${ROLE_IDENTITY_DOMAIN}`)) {
    const local = email.slice(0, -`@${ROLE_IDENTITY_DOMAIN}`.length);
    return input.roles.some((role) => role.toLowerCase() === local) ? "role" : "impostor";
  }
  if (email === "noreply@github.com" || email.endsWith("@users.noreply.github.com")) {
    return "github";
  }
  return "unrecognised";
};

/**
 * The addresses, loudest first, and NEVER SILENTLY CUT: a row that shows six of eleven
 * without saying so reads as "there are six". Ten is where a terminal line stops being
 * read at all; the tail is counted out loud and `--identity-all` prints the archaeology.
 */
const LISTING_CAP = 10;

const listing = (identities: readonly CommitIdentity[]): string => {
  const sorted = [...identities].sort(
    (a, b) => b.commits - a.commits || a.email.localeCompare(b.email),
  );
  const shown = sorted
    .slice(0, LISTING_CAP)
    .map((identity) => `'${identity.name} <${identity.email}>' (${identity.commits})`)
    .join(", ");
  const rest = sorted.length - LISTING_CAP;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
};

/**
 * THE SHAPE THE MEASUREMENT STARTED FROM — "two dev-cores in the GitHub interface":
 * a DECLARED ROLE'S NAME over an address outside the role namespace. It is not a cross
 * (history cannot be fixed, and a stray that landed a week ago would keep a
 * commissioned box red until it aged out of the window), but it is not the same fact as
 * a person's own address either: nobody is called `dev-core` except dev-core, so the
 * row says which of the strays are of this kind.
 */
const roleNamed = (
  identities: readonly CommitIdentity[],
  roles: readonly string[],
): readonly CommitIdentity[] =>
  identities.filter((identity) =>
    roles.some((role) => role.toLowerCase() === identity.name.trim().toLowerCase()),
  );

/**
 * THE ROW. `window` is said in the words the operator typed (`the last 7 days`, `the
 * whole history`), because a row that names a window a flag can move must say which
 * window it measured — a green "all in the canon" over a day is not the same promise
 * as one over a year.
 */
export const commitIdentityCheck = (input: {
  readonly window: string;
  readonly identities: readonly CommitIdentity[];
  readonly roles: readonly string[];
  readonly error?: string;
  readonly dictionary?: string;
}): PreflightCheck => {
  const name = "git: commit identity (history)";
  if (input.error !== undefined) {
    return { name, status: "info", detail: `not asked — ${input.error}` };
  }
  if (input.identities.length === 0) {
    return { name, status: "info", detail: `${input.window} — no commits to judge` };
  }
  const verdicts = input.identities.map((identity) => ({
    identity,
    verdict: identityVerdict({ email: identity.email, roles: input.roles }),
  }));
  const of = (kind: IdentityVerdict): readonly CommitIdentity[] =>
    verdicts.filter((row) => row.verdict === kind).map((row) => row.identity);
  const impostors = of("impostor");
  const strays = of("unrecognised");
  const dictionary = input.dictionary ?? "docs/protocol-reference.md";
  if (impostors.length > 0) {
    return {
      name,
      status: "fail",
      detail: `${input.window} — ${listing(impostors)} sign inside '@${ROLE_IDENTITY_DOMAIN}' and answer to no declared role: some box is committing as a role that does not exist; fix its 'user.email' (the canon is in ${dictionary})`,
    };
  }
  if (strays.length > 0) {
    const wearing = roleNamed(strays, input.roles);
    const shape =
      wearing.length === 0
        ? ""
        : ` ${wearing.length} of them wear a declared role's NAME over an address outside '@${ROLE_IDENTITY_DOMAIN}' (${listing(wearing)}) — that is the "two dev-cores" shape: a checkout whose 'user.email' was set by hand;`;
    return {
      name,
      status: "info",
      detail: `${input.window} — outside the canon this package can derive: ${listing(strays)}.${shape} the rest is either a person's own address (authorized by the dictionary in ${dictionary}) or another box signing by hand — this one cannot tell, the dictionary can`,
    };
  }
  return {
    name,
    status: "ok",
    detail: `${input.window} — ${input.identities.length} identities, every one canonical (roles, ${MACHINERY_IDENTITY}, GitHub)`,
  };
};

/**
 * WHAT THIS BOX WILL SIGN THE NEXT COMMIT WITH (thread 019, task 019.1).
 *
 * WHY THE HISTORY IS NOT ENOUGH, and this is the half that matters on a fresh box: the
 * row above measures the CONSEQUENCE, and over the whole repository. A box commissioned
 * an hour ago has made no commits of its own — the history it reads is somebody else's
 * and it is canonical, so the row says "ok" about a box that is about to sign wrong.
 * When the row does speak, it is too late by construction: the address is in the history
 * and history is not rewritten. The CAUSE is one local question with no network in it —
 * what `git config --get user.email` answers here, which is exactly what git will write
 * into the next commit.
 *
 * WHY AN EMPTY ANSWER IS A CROSS AND NOT A FACT. Unset does not mean "git will refuse";
 * on a box whose hostname carries a domain git derives `<user>@<hostname>` SILENTLY and
 * commits — that is where every `@lle.local`, `@agents.local`, `@agent.local` in this
 * repository's history came from. (On a hostname without a domain git refuses instead,
 * which is why the defect never reproduced on the dev machine.) So the emptiness is the
 * defect itself, seen before it costs anything, and the module's own rule applies: the
 * circuit on this box will do the wrong thing.
 *
 * WHY EVERY OTHER ADDRESS IS A DOT, exactly as in the history: an address the package
 * cannot derive may be a legitimate hand, and the dictionary — not a schema — is what
 * authorizes it. The one exception is the same one the history row makes: a name inside
 * `@agents.invalid` that answers to no declared role means this box signs as somebody
 * who does not exist.
 *
 * WHICH PLACES ARE ASKED, and why more than one: git resolves `user.email` through
 * system → global → local → worktree, so a repository, its mail checkout and each role's
 * workspace can answer differently — and they do, since R17 sets the role's signature on
 * the workspace itself. The answers are printed per place rather than folded together: a
 * cross that does not say WHERE sends the operator to the global config, which may be the
 * one place that was already right.
 *
 * WHAT IT DELIBERATELY DOES NOT JUDGE: whether the address of a role's workspace is that
 * ROLE's address. It is printed beside the place, so a workspace signing as another role
 * is legible; but the orchestrator writes in those trees too, and turning "not the role I
 * expected" into a cross would invent a rule the statement of the canon does not have.
 */
export type SigningPlace = {
  /** In the operator's words: `the checkout`, `the workspace of 'dev-core'`. */
  readonly place: string;
  /** What git answers here, or `null` when it answers nothing at all. */
  readonly email: string | null;
};

const placeListing = (places: readonly SigningPlace[]): string => {
  const shown = places
    .slice(0, LISTING_CAP)
    .map((place) => `${place.place} → '${place.email ?? "nothing"}'`)
    .join(", ");
  const rest = places.length - LISTING_CAP;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
};

/** THE OTHER HALF OF THE ROW: the cause, asked of this disk, before the first commit. */
export const boxIdentityCheck = (input: {
  readonly places: readonly SigningPlace[];
  readonly roles: readonly string[];
  readonly dictionary?: string;
}): PreflightCheck => {
  const name = "git: commit identity (this box)";
  const dictionary = input.dictionary ?? "docs/protocol-reference.md";
  if (input.places.length === 0) {
    return { name, status: "info", detail: "not asked — there is no place on this box to ask of" };
  }
  const unset = input.places.filter((place) => place.email === null || place.email.trim() === "");
  const judged = input.places
    .filter((place) => !unset.includes(place))
    .map((place) => ({
      place,
      verdict: identityVerdict({ email: place.email as string, roles: input.roles }),
    }));
  const impostors = judged.filter((row) => row.verdict === "impostor").map((row) => row.place);
  const strays = judged.filter((row) => row.verdict === "unrecognised").map((row) => row.place);
  if (unset.length > 0 || impostors.length > 0) {
    const sentences = [
      unset.length === 0
        ? ""
        : `${placeListing(unset)}: git has no 'user.email' there and will derive one from the hostname ('<user>@<hostname>') without saying so — that is where the '@*.local' addresses of this history came from;`,
      impostors.length === 0
        ? ""
        : `${placeListing(impostors)}: signs inside '@${ROLE_IDENTITY_DOMAIN}' as a name no declared role answers to — this box commits as somebody who does not exist;`,
    ].filter((sentence) => sentence !== "");
    return {
      name,
      status: "fail",
      detail: `${sentences.join(" ")} set it (the canon is in ${dictionary})`,
    };
  }
  if (strays.length > 0) {
    return {
      name,
      status: "info",
      detail: `${placeListing(input.places)} — outside the canon this package can derive: ${placeListing(strays)}; a person's own address is authorized by the dictionary in ${dictionary}, this one cannot tell it from a box signing by hand`,
    };
  }
  return {
    name,
    status: "ok",
    detail: `${placeListing(input.places)} — every signature canonical (roles, ${MACHINERY_IDENTITY}, GitHub)`,
  };
};

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
