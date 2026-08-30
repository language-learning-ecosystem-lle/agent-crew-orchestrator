/**
 * THE FAILOVER OF ACCOUNTS — thread `036-account-failover`, the decision half.
 *
 * WHAT IT IS FOR. A closed window belongs to an ACCOUNT (`quota.ts`, B.3), and until now
 * that was the end of the sentence: every role spending the shelved account stood down
 * until the window reopened, even when the box held a second live subscription. The week
 * of 23–28.08 is what that costs — the circuit stalled twice in a day and a human moved
 * the remaining quota between threads by hand. This module answers the one question that
 * removes the hand: WHICH account is the next session of this role raised on, given the
 * windows that are closed right now.
 *
 * IT IS THE DECISION AND NOTHING ELSE. Pure, total, no config, no filesystem, no journal:
 * a chain of account ids in, a named choice out. The trigger (`quotaSignalOf` →
 * `lease-released/quota-exhausted` → `openQuotaShelves`) already exists and is NOT
 * touched — this module never decides that a window is closed, it only reads the shelves
 * that decision produced. That is the whole of requirement §2 of the statement of work as
 * code sees it: a switch happens on a SHELF and on nothing else, so a network failure, a
 * 5xx or an unknown death — none of which open a shelf — cannot move a role off its
 * account. There is no second, looser signal here on purpose.
 *
 * THE CHAIN IS EXPLICIT AND ORDERED (decision of curator, msg-002 §1). Not "any live
 * account of the box": accounts are not interchangeable — model, tariff, limits and owner
 * differ, and "any" is how a cheap role quietly starts burning an expensive subscription.
 * A role names its own fall-backs in order; an empty chain means failover is OFF for that
 * role and the behaviour is what it is today, to the line.
 *
 * THE KIND IS NOT NEGOTIABLE (john, 24.08, thread 026). A fall-back of another kind is
 * refused BY NAME and never spent: `claude-code` pointed at a `codex` home is not a
 * cheaper session, it is a run that dies on credentials or, worse, a different tool
 * raised for a role that never asked for one. What this module does with such an entry is
 * to refuse it and CARRY ON down the chain — one misconfigured link must not stand a role
 * down while a valid link waits behind it, and the refusal is not lost: it travels in the
 * answer and is printed. Silence from the machine (`accounts.<id>.kind` absent) is not a
 * mismatch and is not treated as one: "nothing is claimed" is what that field's absence
 * means (`local.ts`), and the launch door still refuses a real conflict.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not move a LIVE session — the switch is on the
 * boundary of sessions only (msg-002 §3): the running session finishes as it is, its turn
 * is in the mail either way, and the NEXT one is raised elsewhere. Nothing here carries
 * context between harnesses, because nothing can.
 */

import {
  BOX_ACCOUNT,
  describeAccount,
  type QuotaShelf,
  resumesAt,
  shelvesAgainst,
} from "./quota.js";

/** What this box declares about one account — presence in the map IS "declared here". */
export type DeclaredAccount = {
  /** `accounts.<id>.kind` of the machine config, when the machine claims one. */
  readonly kind?: string | undefined;
};

/** A fall-back that will NOT be spent, and why — printed, never swallowed. */
export type AccountRefusal = {
  /** The id as the role named it. */
  readonly id: string;
  /** The sentence an operator repairs the config by. */
  readonly reason: string;
};

/**
 * THE ANSWER, in three named shapes — because they are three different facts about the
 * box and an operator acts differently on each:
 *
 *  · `stay` — the account this role always spends is open (or the role has no chain at
 *    all). Today's behaviour, and the overwhelming majority of ticks;
 *  · `failover` — the primary's window is closed and a fall-back of the same kind is
 *    open. This is the LOUD one: it moves whose money is spent, so it carries the shelf
 *    it ran from and is announced (`describeFailover`) rather than logged in passing;
 *  · `paused` — every link of the chain is shelved. Not silence and not `stay`: the
 *    caller stands the role down until `until`, and the time is the EARLIEST reopening
 *    of the chain, because that is the first moment anything can be raised at all.
 */
export type AccountChoice =
  | {
      readonly kind: "stay";
      /** The account to spend; absent means the box's own, exactly as elsewhere. */
      readonly account?: string;
      readonly refusals: readonly AccountRefusal[];
    }
  | {
      readonly kind: "failover";
      readonly account: string;
      /** Whose window pushed the role off — an id, or {@link BOX_ACCOUNT} for the box's own. */
      readonly from: string;
      /** The shelf that did it — the evidence of the announcement. */
      readonly shelf: QuotaShelf;
      readonly refusals: readonly AccountRefusal[];
    }
  | {
      readonly kind: "paused";
      /** The shelf that reopens FIRST across the whole chain — when anything can move again. */
      readonly until: QuotaShelf;
      readonly refusals: readonly AccountRefusal[];
    };

export type FailoverInput = {
  /** The account the role spends today (`launch.account` / `instances[].account`), or the box's own. */
  readonly primary?: string | undefined;
  /** The ordered fall-backs of this role. Empty or absent — failover is off for it. */
  readonly fallback?: readonly string[] | undefined;
  /** The tool this role is raised as (`launch.agent.kind`) — a fall-back must match it. */
  readonly worker: string;
  /** What this box declares about its accounts (`accounts` of the machine config). */
  readonly accounts?: Readonly<Record<string, DeclaredAccount>> | undefined;
  /** The windows closed right now — {@link openQuotaShelves} of the journal. */
  readonly shelves: readonly QuotaShelf[];
};

/** The earliest-reopening shelf of a set — the first moment the chain can move again. */
const firstToReopen = (shelves: readonly QuotaShelf[]): QuotaShelf | undefined =>
  shelves.reduce<QuotaShelf | undefined>(
    (earliest, shelf) =>
      earliest === undefined || shelf.until < earliest.until ? shelf : earliest,
    undefined,
  );

/**
 * WHY A NAMED FALL-BACK MAY NOT BE SPENT, or `undefined` when it may. Three refusals, and
 * every one of them names the file the reader repairs:
 *
 *  · it IS the primary — a chain that falls back onto the closed window it is running
 *    from is not a chain, and reading it as one would raise the role on the shelf it just
 *    left;
 *  · this machine declares no such account — the same refusal `resolveAccount` makes at
 *    the launch door, made one step earlier so the planner never picks an id that cannot
 *    be placed. A quiet fall-back to the box's own account is the answer that must not
 *    exist: it spends a subscription nobody assigned;
 *  · the machine declares it as another kind — see the block above.
 */
const refusalOf = (input: {
  readonly id: string;
  readonly primary?: string | undefined;
  readonly worker: string;
  readonly accounts?: Readonly<Record<string, DeclaredAccount>> | undefined;
}): string | undefined => {
  if (input.id === input.primary)
    return `it is the account the role already spends — a fall-back onto the closed window it is running from would raise the role on the shelf it just left; name another account or drop the entry`;
  const declared = input.accounts?.[input.id];
  if (declared === undefined)
    return `this machine declares no such account — say where it lives ('accounts.${input.id}.configDir' of the machine config) or drop it from the chain; it is NOT quietly replaced by the box's own account, which would spend a subscription nobody assigned`;
  if (declared.kind !== undefined && declared.kind !== input.worker)
    return `this machine declares it as '${declared.kind}' ('accounts.${input.id}.kind') while the role is raised as '${input.worker}' — a fall-back of another kind is a different TOOL, not a spare key, and this box will not point one tool at another's home; send the role to a spare account of its own kind`;
  return undefined;
};

/**
 * THE CHAIN → THE ACCOUNT THE NEXT SESSION OF THIS ROLE IS RAISED ON.
 *
 * The order of the answers is the order of the chain and nothing else: the primary first
 * (a role never leaves its own account while that account works), then each fall-back in
 * the order the role names them. The first link that is neither shelved nor refused wins.
 *
 * Pure and total: it never throws and reads no clock — the shelves handed in are already
 * the ones open at `now`, and asking the time twice is how a planner and its own
 * explanation start disagreeing.
 */
export const chooseAccount = (input: FailoverInput): AccountChoice => {
  const refusals: AccountRefusal[] = [];
  const primaryShelves = shelvesAgainst(input.shelves, input.primary);
  if (primaryShelves.length === 0)
    return {
      kind: "stay",
      ...(input.primary === undefined ? {} : { account: input.primary }),
      refusals,
    };

  const shelved: QuotaShelf[] = [...primaryShelves];
  const seen = new Set<string>();
  for (const id of input.fallback ?? []) {
    // A repeated id is not refused with a sentence: it is the same link twice, and the
    // first pass already said everything true about it.
    if (seen.has(id)) continue;
    seen.add(id);
    const reason = refusalOf({
      id,
      ...(input.primary === undefined ? {} : { primary: input.primary }),
      worker: input.worker,
      ...(input.accounts === undefined ? {} : { accounts: input.accounts }),
    });
    if (reason !== undefined) {
      refusals.push({ id, reason });
      continue;
    }
    const against = shelvesAgainst(input.shelves, id);
    if (against.length > 0) {
      shelved.push(...against);
      continue;
    }
    return {
      kind: "failover",
      account: id,
      from: input.primary ?? BOX_ACCOUNT,
      // The shelf named as the CAUSE is the primary's own, and the first of them: it is
      // the window the role is actually leaving, and naming a fall-back's shelf here
      // would explain the switch with a door the role never knocked on.
      shelf: primaryShelves[0] as QuotaShelf,
      refusals,
    };
  }
  // Nothing in the chain is open. `firstToReopen` cannot be undefined here — the primary
  // contributed at least one shelf — but the type says it can, and a non-null assertion
  // would be this module claiming a fact the compiler cannot see.
  const until = firstToReopen(shelved) ?? (primaryShelves[0] as QuotaShelf);
  return { kind: "paused", until, refusals };
};

/**
 * THE CHAIN JUDGED WHERE IT IS DECLARED, not where it is spent (curator, msg-004 §3).
 *
 * `chooseAccount` above reaches a fall-back only when the primary's window is already
 * closed — which means a typo in a chain would be met at the WORST possible moment: the
 * one where quota has just run out and the role needs the spare it cannot have. So the
 * same three refusals are computed a second time, at declaration time, by the doors that
 * read the config with nobody waiting (`config check`, `doctor`), and a fourth is added
 * that the runtime deliberately stays silent about:
 *
 *  · A REPEATED ID. At runtime it is nothing — the second pass says what the first one
 *    already said, and refusing it would stand a role down over a harmless duplication.
 *    In a config it is a defect all the same: a chain of three links two of which are the
 *    same account is a chain the author believes is longer than it is.
 *
 * WHAT THE MACHINE HAS NOT SAID IS NOT A FINDING. `accounts` absent (an unreadable or
 * missing machine config — the notifier's case, thread 026 П3-3) means the two refusals
 * that quote the machine are NOT computed: "this box declares no such account" said by a
 * box that declared nothing at all is a sentence about the reader, not about the config.
 * The two that are true of the repository alone — the role's own account, and the same id
 * twice — are computed either way, because they are wrong in every checkout.
 *
 * The order of the answers is the order of the chain: a reader repairs the file top down.
 */
export const chainRefusals = (input: {
  /** The account the role spends today — `launch.account`, or the instance's default. */
  readonly primary?: string | undefined;
  /** The chain as the card writes it, in its own order. */
  readonly fallback?: readonly string[] | undefined;
  /** The tool the role is raised as (`launch.agent.kind`). */
  readonly worker: string;
  /** What the machine declares, or `undefined` when this reader could not ask it. */
  readonly accounts?: Readonly<Record<string, DeclaredAccount>> | undefined;
}): readonly AccountRefusal[] => {
  const refusals: AccountRefusal[] = [];
  const seen = new Set<string>();
  for (const id of input.fallback ?? []) {
    if (seen.has(id)) {
      refusals.push({
        id,
        reason: `it is named twice in the same chain — the second entry is dead weight and the chain is one link shorter than it looks; drop the repeat or name the account that was meant`,
      });
      continue;
    }
    seen.add(id);
    // The two refusals that quote the machine are the machine's to make: with no reading
    // of it, `refusalOf` would answer "this box declares no such account" about a box that
    // declared nothing at all — a sentence about the reader, not about the config.
    if (id !== input.primary && input.accounts === undefined) continue;
    const reason = refusalOf({
      id,
      ...(input.primary === undefined ? {} : { primary: input.primary }),
      worker: input.worker,
      ...(input.accounts === undefined ? {} : { accounts: input.accounts }),
    });
    if (reason !== undefined) refusals.push({ id, reason });
  }
  return refusals;
};

/**
 * A REFUSED LINK AS THE CONFIG DOOR SAYS IT — the role, the key, and the repair.
 *
 * The runtime line ({@link describeRefusals}) is read by whoever is looking at a circuit
 * that did not move; this one is read by whoever is holding the file open, so it names the
 * KEY rather than the moment: `roles[].launch.fallback` of that role's card is where the
 * edit goes.
 */
export const describeChainRefusal = (input: {
  readonly role: string;
  readonly refusal: AccountRefusal;
}): string =>
  `role '${input.role}': the fall-back '${input.refusal.id}' ('roles[].launch.fallback') will never be spent — ${input.refusal.reason}`;

/**
 * THE SWITCH IN ONE LINE, FOR THE DIGEST OF THE PERSON WHOSE MONEY IT IS (msg-002 §4).
 *
 * A failover is not a log detail: it moves the spending of a run from one subscription to
 * another, and the owner of both has to learn it from the system rather than from a bill.
 * The line therefore says all three things a decision is audited by — who moved, off which
 * closed window, onto what — and the reopening time of the window that caused it, so the
 * same line answers "and when does the normal state come back".
 */
export const describeFailover = (input: {
  readonly role: string;
  readonly choice: Extract<AccountChoice, { kind: "failover" }>;
}): string =>
  `account-failover: ${input.role} is raised on ${describeAccount(input.choice.account)} — ${describeAccount(input.choice.from)} is quota-paused until ${resumesAt(input.choice.shelf)} (${input.choice.shelf.window} window, seen at ${input.choice.shelf.since})`;

/**
 * THE STANDSTILL IN ONE LINE, WITH THE CLOCK ON IT (msg-002 §3, the tail of it).
 *
 * "No spare account" used to be silence — the role simply was not raised, and a human
 * went looking for a defect that was not there. This is the sentence that replaces the
 * silence: raising is HELD, until when, and how many links of the chain are shut, so the
 * reader can tell "my one account ran out" from "all three did".
 */
export const describeAccountPause = (input: {
  readonly role: string;
  readonly choice: Extract<AccountChoice, { kind: "paused" }>;
}): string =>
  `account-failover: launches of ${input.role} are held until ${resumesAt(input.choice.until)} — every account of its chain is quota-paused (the first to reopen is ${describeAccount(input.choice.until.account)}, ${input.choice.until.window} window)`;

/**
 * THE REFUSED LINKS, ONE LINE EACH — a door that stays quiet is worse than no door.
 *
 * They are printed whether or not the choice needed them: an entry that will never be
 * spent is a defect of the config, and the only moment it is cheap to fix is the moment
 * somebody reads why the role did not move.
 */
export const describeRefusals = (input: {
  readonly role: string;
  readonly refusals: readonly AccountRefusal[];
}): readonly string[] =>
  input.refusals.map(
    (refusal) =>
      `account-failover: the fall-back '${refusal.id}' of ${input.role} is NOT spent — ${refusal.reason}`,
  );
