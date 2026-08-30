/**
 * INIT — COMMISSIONING A BOX AS A COMMAND (thread 019, the operator tail: "the
 * commissioning of a box is CLI commands, not a correspondence with curator").
 *
 * `doctor` answers whether this box is ready. This is the other half of the same
 * evening: the thing that MAKES it ready. The measurement behind both is the same —
 * bringing the VPS `acme-agents` into service took an evening and about a dozen hand
 * steps typed out of a chat, and every one of those steps ended in a fact that only
 * this machine can hold: which instance it is, where its agent binary sits, where its
 * transport credentials lie, where the mail checkout is.
 *
 * THE PAIR IS THE POINT, AND IT DECIDES THE SHAPE OF THIS MODULE. `init` writes
 * exactly the facts `doctor` asks about, and ends by running `doctor` — so the
 * commissioning is not "the operator believes they typed the right things" but "the
 * checklist is green". Neither command may therefore be the judge of its own work:
 * everything `init` writes is re-read from disk by `doctor` afterwards, through the
 * ordinary loaders, not from what this module happened to hold in memory.
 *
 * WHAT IT MAY NOT DO, and each refusal has a reason rather than a taste:
 *
 *  - **It never invents an identity.** A box that does not know which instance it is
 *    gets a REFUSAL naming the flag, not a guess: the guess would be another box's
 *    role raised on this one, which is the single failure R13 exists to prevent.
 *  - **It never writes a secrets file.** It records WHERE the credentials will lie
 *    (`secrets.envFile` — a path, and a path is not a secret) and stops. An empty file
 *    created here would read as "configured" in every row that prints it, and the
 *    transport would fail at delivery time instead of at commissioning time.
 *  - **It never silently overwrites.** A value already in the machine config and a
 *    different value on the command line are a CHANGE, printed with both sides. The
 *    file is hand-written by a human on the day the box is set up and by nobody
 *    afterwards; a command that rewrites it quietly is how a box ends up running with
 *    settings nobody chose.
 *  - **Without `--write` it decides and prints, and does none of it** — the same word
 *    the rest of the machine-local commands use, in the same sense `orchestrator run`
 *    uses it: not "write the file", but "do it". ONE effect survives the plan and is
 *    printed by name: on a box with no mail checkout yet, reading whether the instance
 *    id is already taken fetches the mail branch (`origin/<branch>` moves, nothing
 *    else). That read is the reason the warning reaches the operator BEFORE the id is
 *    taken; `--offline` declines it, and then the plan really does touch nothing.
 *
 * This module is the pure core: facts in, steps out. Every effect — resolving the
 * binary in the child's environment, creating the mail worktree, writing the JSON —
 * lives in the CLI, where the effects are.
 */

import type { LocalConfig } from "../config/local.js";
import { type AgentKind, CLAUDE_CODE } from "./kind.js";

/**
 * WHAT INIT DECIDED ABOUT ONE FACT. The vocabulary is deliberately not preflight's
 * ✓/·/✗ (R12): those three answer "is this as it should be", and these answer "what am
 * I about to do to it", which is a different question asked at a different moment. A
 * step that reads `keep` next to a `✓` would be two words for one thing; a step that
 * reads `keep` next to a ✗ is exactly the case an operator must see (the value is
 * already there AND it is wrong, so `init` is not the command that will fix it).
 *
 *  - `set` — this box did not say it, and now it does;
 *  - `keep` — it already says it, with the same value; nothing is written;
 *  - `change` — it says something else, and the operator named a new value: both sides
 *    are printed, because this is the destructive one;
 *  - `create` — something on disk is brought into being (the mail worktree);
 *  - `skip` — nothing was asked for and nothing is needed; a legitimate end state;
 *  - `missing` — a fact this box cannot be commissioned without, which `init` refuses
 *    to guess. The detail names the flag that supplies it.
 */
export type InitAction = "set" | "keep" | "change" | "create" | "skip" | "missing";

export type InitStep = {
  readonly name: string;
  readonly action: InitAction;
  readonly detail: string;
};

/** What another box has published about an instance id (R13, `_instances/<id>.json`). */
export type InstanceOccupant = {
  readonly writtenAt: string;
  readonly roles: readonly string[];
};

/**
 * WHICH INSTANCE THIS BOX IS — the one fact of the whole command that has no default
 * and never will (R13/R14: the repository declares WHICH instances exist, only the box
 * can say which of them it is).
 *
 * The occupancy warning is the statement's own: an id already taken by a neighbour is
 * named WITH the neighbour, out of `_instances/`. It is a warning and not a refusal on
 * purpose — the digest carries no machine identity, so a box re-commissioning ITSELF
 * (the rebuild in the acceptance criterion) would be refused by a rule that treated its
 * own file as somebody else's. What the operator needs here is the fact and the
 * consequence, in their own hands.
 */
export const instanceStep = (input: {
  readonly requested?: string;
  readonly current?: string;
  readonly declared: readonly string[];
  readonly occupant?: InstanceOccupant;
  readonly unchecked?: string;
}): InitStep => {
  const name = "instance";
  const declared =
    input.declared.length === 0 ? "" : ` (the repository declares ${quoteAll(input.declared)})`;
  const value = input.requested ?? input.current;
  if (value === undefined) {
    if (input.declared.length === 0) {
      return {
        name,
        action: "skip",
        detail: "the repository declares no instances — one box, every role; nothing to name",
      };
    }
    return {
      name,
      action: "missing",
      detail: `this box has no name while the repository declares ${quoteAll(input.declared)} — name it with --instance <id>, or it raises nobody`,
    };
  }
  const bench =
    input.declared.length > 0 && !input.declared.includes(value)
      ? ` — not declared in the repository${declared}: a bench, it raises no role of this project`
      : "";
  // NO DATA IS NOT 'NOBODY IS THERE'. When the occupancy could not be looked up at all,
  // the step says so instead of staying silent: silence here reads as a free id, and an
  // id taken twice is the one thing R13 rules out by construction.
  const taken =
    input.occupant === undefined || input.occupant === null
      ? input.unchecked === undefined || input.unchecked === ""
        ? ""
        : ` — occupancy of '${value}' NOT checked (${input.unchecked}): another box may already publish under it`
      : ` — WARNING: '${value}' already publishes a digest (written ${input.occupant.writtenAt}, ${
          input.occupant.roles.length === 0
            ? "no roles"
            : `roles ${input.occupant.roles.join(", ")}`
        }); if that is another box, two boxes under one id raise one role twice`;
  if (input.requested === undefined) {
    return {
      name,
      action: "keep",
      detail: `'${value}', already named by this box${bench}${taken}`,
    };
  }
  if (input.current === undefined) {
    return { name, action: "set", detail: `'${value}'${bench}${taken}` };
  }
  if (input.current === input.requested) {
    return { name, action: "keep", detail: `'${value}', unchanged${bench}${taken}` };
  }
  return {
    name,
    action: "change",
    detail: `'${input.current}' → '${input.requested}'${bench}${taken}`,
  };
};

/**
 * WHERE THE AGENT BINARY IS on this box. This is the hole R14 was opened for — the
 * `--exec /home/…/versions/node/v18.20.3/bin/claude` that lived in one shell history —
 * and the answer is normally not typed at all: `command -v` in the child's environment
 * already knows it, and the version string is carried through so the operator sees WHAT
 * was found rather than only THAT something was.
 */
export const agentStep = (input: {
  readonly kind: string;
  readonly requested?: string;
  readonly current?: string;
  readonly resolved?: string;
  readonly version?: string;
}): InitStep => {
  const name = `agent: ${input.kind}`;
  const said = input.version === undefined ? "" : ` (${input.version})`;
  const value = input.requested ?? input.resolved;
  if (value === undefined) {
    if (input.current !== undefined) {
      return {
        name,
        action: "keep",
        detail: `${input.current}, already declared — nothing on PATH to compare it with`,
      };
    }
    return {
      name,
      action: "missing",
      detail: `no '${input.kind}' binary on PATH and none declared — name it with --exec <path>`,
    };
  }
  if (input.current === undefined) return { name, action: "set", detail: `${value}${said}` };
  if (input.current === value) {
    return { name, action: "keep", detail: `${value}${said}, unchanged` };
  }
  // Only what the OPERATOR named overwrites a declared path. A binary found on PATH
  // that disagrees with the config is a fact worth printing and no basis for a rewrite:
  // the declared one may be a deliberate pin (a second install, a wrapper), and R14's
  // whole subject is that this file is knowledge of one machine, held by its human.
  if (input.requested === undefined) {
    return {
      name,
      action: "keep",
      detail: `${input.current}, already declared — PATH offers ${value}${said}; pass --exec to change it`,
    };
  }
  return { name, action: "change", detail: `${input.current} → ${value}${said}` };
};

/**
 * WHO SITS AT THIS BOX — the role a hold taken here is signed by. Optional by
 * construction (the `$USER` fall-back still works where the account name is a role), so
 * its absence is a `skip` and never a `missing`.
 */
export const operatorStep = (input: {
  readonly requested?: string;
  readonly current?: string;
  readonly known: readonly string[];
}): InitStep => {
  const name = "operator";
  const value = input.requested ?? input.current;
  if (value === undefined) {
    return {
      name,
      action: "skip",
      detail: "not named — holds taken here fall back to $USER; --operator <role> settles it",
    };
  }
  const unknown = input.known.includes(value)
    ? ""
    : ` — WARNING: '${value}' is no role of this project (${quoteAll(input.known)}); a hold signed by it is refused`;
  if (input.requested === undefined || input.current === input.requested) {
    return { name, action: "keep", detail: `${value}${unknown}` };
  }
  if (input.current === undefined) return { name, action: "set", detail: `${value}${unknown}` };
  return { name, action: "change", detail: `${input.current} → ${value}${unknown}` };
};

/**
 * WHERE ONE ACCOUNT OF THIS BOX LIVES (thread 055) — the machine's half of the join
 * `launch.account` opens: the repository says WHICH subscription a role is raised on,
 * this says WHERE that account's directory is on this disk.
 *
 * A directory that is not there yet is the ORDINARY case and not a refusal, for the
 * same reason `secretsStep` records a missing file: the order the operator works in is
 * "declare where it goes, then log in" — and the login is the step that creates the
 * directory. So the detail carries the exact command that fills it, with the path
 * already in it: the account is useless until a human runs it, and an operator who has
 * to reconstruct `CLAUDE_CONFIG_DIR=… claude login` from prose is an operator who
 * types it into the wrong shell once.
 *
 * WHAT IT DOES NOT DO is judge whether that directory holds a LIVE token: `doctor`
 * probes each declared account for real and is the command that answers it.
 */
export const accountStep = (input: {
  readonly id: string;
  readonly requested: string;
  readonly current?: string;
  /** Whether the directory is on this disk already. Unknown (`undefined`) says nothing. */
  readonly exists?: boolean;
  /** Whose login command this step dictates — see {@link AgentKind.loginHint} (thread 026). */
  readonly kind?: AgentKind;
}): InitStep => {
  const name = `account: ${input.id}`;
  const there =
    input.exists === false
      ? ` — nothing at that path yet; the login creates it: ${(input.kind ?? CLAUDE_CODE).loginHint(input.requested)}`
      : "";
  if (input.current === input.requested) {
    return { name, action: "keep", detail: `${input.requested}${there}, unchanged` };
  }
  if (input.current === undefined) {
    return { name, action: "set", detail: `${input.requested}${there}` };
  }
  return { name, action: "change", detail: `${input.current} → ${input.requested}${there}` };
};

/**
 * WHERE THE TRANSPORT CREDENTIALS LIE (R4) — a path, and only a path; the file itself
 * is never created here (see the module doc). A named file that is not there yet is
 * reported as such and still recorded: the order "say where it goes, then put it there"
 * is the order the operator works in, and a config that refused to hold the path until
 * the file existed would make them keep it in their head instead.
 */
export const secretsStep = (input: {
  readonly requested?: string;
  readonly current?: string;
  readonly exists?: boolean;
}): InitStep => {
  const name = "secrets";
  const value = input.requested ?? input.current;
  if (value === undefined) {
    return {
      name,
      action: "skip",
      detail:
        "no secrets file declared — the notifier delivers nothing without one; --secrets <path> records where it lies (init never writes the file itself)",
    };
  }
  const there =
    input.exists === true ? "" : " — the file is not there yet; put the KEY=value lines in it";
  if (input.requested === undefined || input.current === input.requested) {
    return { name, action: "keep", detail: `${value}${there}` };
  }
  if (input.current === undefined) return { name, action: "set", detail: `${value}${there}` };
  return { name, action: "change", detail: `${input.current} → ${value}${there}` };
};

/**
 * THE MAIL CHECKOUT, CREATED WITH A FETCH. The fetch is not an optimisation, it is the
 * defect this line exists for: the checkout on `acme-agents` was created by hand without
 * one, and the circuit read `mail: never pulled` in every frame afterwards — a box that
 * looks commissioned and works on yesterday's mail.
 */
export const mailStep = (input: {
  readonly path: string;
  readonly present: boolean;
  readonly branch: string;
}): InitStep =>
  input.present
    ? { name: "mail: checkout", action: "keep", detail: `${input.path}, already there` }
    : {
        name: "mail: checkout",
        action: "create",
        detail: `${input.path} — worktree of '${input.branch}', created after a fetch (a checkout made without one reads as "never pulled")`,
      };

/**
 * The machine config as it will be ON DISK. A pure merge, so the file that is written
 * and the steps that were printed cannot disagree: both are computed from the same
 * decisions, and `undefined` means "this box said nothing about it" rather than
 * "erase it" — nothing here removes a key.
 */
export const nextLocalConfig = (
  current: LocalConfig,
  decisions: {
    readonly instance?: string;
    readonly operator?: string;
    readonly agent?: { readonly kind: string; readonly exec: string };
    readonly secretsEnvFile?: string;
    /**
     * WHICH CHECKOUT THIS INSTANCE SERVES (thread 055) — written only into a NAMED
     * config, because it is what makes the checkout layer of the resolution work:
     * commissioning `instances/crew.json` from the crew checkout is what lets every
     * later command typed there find it without naming it.
     */
    readonly repo?: string;
    /**
     * ONE ACCOUNT OF THIS BOX (thread 055). Merged into the map like an agent — never
     * replacing it: a box with two subscriptions declares them one command at a time,
     * and the second declaration must not be how the first one disappears.
     */
    readonly account?: { readonly id: string; readonly configDir: string };
  },
): LocalConfig => ({
  ...current,
  agents:
    decisions.agent === undefined
      ? current.agents
      : { ...current.agents, [decisions.agent.kind]: { exec: decisions.agent.exec } },
  // OPTIONAL AND MEANT AS SUCH (`localConfigSchema`): a box that declares no accounts
  // keeps the key absent rather than growing an empty map, because absence is what says
  // "every role here spends this box's own login".
  ...(decisions.account === undefined
    ? current.accounts === undefined
      ? {}
      : { accounts: current.accounts }
    : {
        accounts: {
          ...(current.accounts ?? {}),
          [decisions.account.id]: { configDir: decisions.account.configDir },
        },
      }),
  ...(decisions.instance === undefined
    ? current.instance === undefined
      ? {}
      : { instance: current.instance }
    : { instance: decisions.instance }),
  ...(decisions.operator === undefined
    ? current.operator === undefined
      ? {}
      : { operator: current.operator }
    : { operator: decisions.operator }),
  ...(decisions.repo === undefined
    ? current.repo === undefined
      ? {}
      : { repo: current.repo }
    : { repo: decisions.repo }),
  ...(decisions.secretsEnvFile === undefined
    ? current.secrets === undefined
      ? {}
      : { secrets: current.secrets }
    : { secrets: { envFile: decisions.secretsEnvFile } }),
});

/** A fact the box cannot be commissioned without. Their presence is the refusal. */
export const initBlockers = (steps: readonly InitStep[]): readonly InitStep[] =>
  steps.filter((step) => step.action === "missing");

/** Whether anything at all would be touched — a plan of pure `keep`s says so out loud. */
export const initTouches = (steps: readonly InitStep[]): boolean =>
  steps.some(
    (step) => step.action === "set" || step.action === "change" || step.action === "create",
  );

/**
 * THE ONE LINE THAT SAYS WHAT HAPPENED, in the two tenses that matter: without
 * `--write` it is what WOULD be done (and the line says the flag), with it, what was.
 *
 * `fetched` is the ONE exception to "the plan does nothing", and it is named rather than
 * hidden (round 7 of thread 019): reading whether the instance id is already published
 * means fetching the mail branch, which moves `origin/<branch>` on this disk. The line
 * used to promise "nothing was touched" while doing exactly that. The effect is small
 * and the alternative is worse — a warning about a taken id that arrives only together
 * with the write is a warning after the decision — so the plan keeps the read and says
 * it. When there was no read (a mail checkout already on disk, or `--offline`), the
 * plain sentence stands, because then it is true.
 */
export const initSummary = (input: {
  readonly steps: readonly InitStep[];
  readonly write: boolean;
  readonly fetched?: string;
}): string => {
  const blocked = initBlockers(input.steps);
  if (blocked.length > 0) {
    return `init: cannot commission this box — ${blocked.map((step) => step.name).join(", ")}`;
  }
  const counted = (action: InitAction): number =>
    input.steps.filter((step) => step.action === action).length;
  const changes = `${counted("set")} set, ${counted("change")} changed, ${counted("create")} created, ${counted("keep")} kept`;
  if (!input.write) {
    return input.fetched === undefined
      ? `init: this is the plan — ${changes}; nothing was touched (--write does it)`
      : `init: this is the plan — ${changes}; none of it was done (--write does it) — the one thing that happened is the read of the id's occupancy: '${input.fetched}' was fetched, so 'origin/${input.fetched}' moved on this disk and nothing else did (--offline leaves it unasked)`;
  }
  if (!initTouches(input.steps)) {
    return `init: this box was already commissioned — ${changes}, nothing to do`;
  }
  return `init: done — ${changes}; the checklist below is doctor's answer, not init's`;
};

/** One row, in the two-column shape `preflight`/`doctor` print. */
export const renderInitSteps = (steps: readonly InitStep[]): string => {
  const width = Math.max(0, ...steps.map((step) => step.name.length));
  return steps
    .map((step) => `${MARK[step.action]} ${step.name.padEnd(width)}  ${step.detail}`)
    .join("\n");
};

const MARK: Record<InitAction, string> = {
  set: "+",
  keep: "=",
  change: "~",
  create: "+",
  skip: "·",
  missing: "✗",
};

const quoteAll = (ids: readonly string[]): string => ids.map((id) => `'${id}'`).join(", ");
