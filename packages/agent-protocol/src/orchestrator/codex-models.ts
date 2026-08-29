/**
 * THE PAIR «MODEL × EFFORT», WHICH IS THE THING THE ENUM CANNOT SEE (thread
 * `041-model-effort-pair`; john's word of 2026-08-28, delivered through thread `026`:
 * "the vocabulary — validate the pair model×effort").
 *
 * {@link codexEffortSchema} guards a WORD: is `max` a level codex ever accepts. It is, on
 * four models of six. What it cannot ask is the only question that decides whether a run
 * lives — does THE MODEL THIS CARD NAMES carry that level. `gpt-5.4-mini` does not, and the
 * card of the pilot role names exactly that model, so the config passes the door and the
 * session dies at the vendor with a lease already spent. That hole was written down as
 * open (`docs/protocol-reference.md`, "what this door still does not catch") before it was
 * closed here; closing it needs a MODEL LIST at validation time, which is a different
 * source of truth from an enum and is why it lives in its own file.
 *
 * THE SOURCE IS THE VENDOR'S OWN CACHE, NOT A TABLE OF OURS. `$CODEX_HOME/models_cache.json`
 * (default `~/.codex/models_cache.json`) is written by the vendor's CLI itself: it carries
 * `client_version`, `fetched_at` and, per model, `supported_reasoning_levels`. A table
 * typed into this repository would be a copy of a live list and would start lying the day
 * the vendor ships a model — which is the exact accident thread `026` spent a version on.
 * So the list is READ, never embedded, and the tests use a fixture of the shape rather than
 * a snapshot of the contents.
 *
 * AND THE FILE IS NOT EVERYWHERE, WHICH DECIDES THE FORM OF THE ANSWER. It exists on a box
 * where the vendor's CLI has run at least once and does NOT exist on a CI runner, where
 * `config check` also runs. Three states, and the door tells them apart by name instead of
 * collapsing them into one verdict:
 *
 *  - the list is there and the model is on it → the pair is JUDGED. A level the model does
 *    not carry is a refusal by name, with both halves of the pair, the levels that model
 *    does carry, and the source with its `fetched_at`;
 *  - the list is there and the model is NOT on it → NOT JUDGED, said out loud. A cache can
 *    be stale and a catalogue changes without us; refusing here would be this package
 *    inventing a verdict about a model it has never seen;
 *  - the list is not readable at all → NOT CHECKED, said out loud, naming the path that was
 *    looked at. Neither a silent pass (which is the defect) nor a refusal "just in case"
 *    (which would turn every CI run red over a file CI has no reason to own).
 *
 * WHAT THIS MODULE DOES NOT CLAIM. It does not run the vendor to see whether the pair is
 * refused — that costs money and proves nothing about tomorrow. It says "by the vendor's
 * own list, this model does not carry this level", names where the list came from, and
 * leaves the reader able to check it by hand. That naming IS the replacement for a test
 * nobody can write against a live catalogue.
 */
import { join } from "node:path";

import { z } from "zod";

/** The vendor's file, by its own name — joined onto whichever home is in force. */
export const CODEX_MODELS_CACHE = "models_cache.json";

/**
 * The shape read out of the cache, and nothing beyond it. The file carries a dozen more
 * fields per model (prompts, service tiers, upgrade banners); a schema that named them
 * would break on the vendor's next release for no gain, so unknown keys are passed over
 * and only the three that answer the question are required.
 */
const cacheSchema = z.object({
  fetched_at: z.string().optional(),
  client_version: z.string().optional(),
  models: z.array(
    z.object({
      slug: z.string(),
      supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional(),
    }),
  ),
});

/** The vendor's list as this package needs it, or the named reason there is none. */
export type CodexCatalogue =
  | {
      readonly available: true;
      /** The file it was read from — printed, because a judgement whose source is unnamed cannot be checked. */
      readonly source: string;
      readonly clientVersion: string;
      readonly fetchedAt: string;
      /** slug → the levels that model carries, in the vendor's order. */
      readonly levels: ReadonlyMap<string, readonly string[]>;
    }
  | {
      readonly available: false;
      /** Every path that was tried, so the reader can put the file where the door looks. */
      readonly looked: readonly string[];
      /** Why there is no list: missing, unreadable, or not the shape this reader knows. */
      readonly why: string;
    };

/**
 * WHERE THE LIST IS LOOKED FOR. `CODEX_HOME` wins when it is set, because that is the
 * variable the vendor itself obeys and the one this package already hands a raised codex
 * session ({@link CODEX.accountEnv}) — a box running two accounts has two homes, and the
 * catalogue of the home in force is the one that describes the run. Otherwise the vendor's
 * default, `~/.codex`.
 */
export const codexCataloguePaths = (input: {
  readonly codexHome?: string | undefined;
  readonly homeDir: string;
}): readonly string[] => {
  const home = input.codexHome?.trim();
  if (home !== undefined && home !== "") return [join(home, CODEX_MODELS_CACHE)];
  return [join(input.homeDir, ".codex", CODEX_MODELS_CACHE)];
};

/**
 * The reader, taking its filesystem as an argument: the unit tests are then a table of
 * contents rather than a directory tree, and the one place that touches the disk is the
 * CLI. `read` returns `undefined` for "no such file" and throws for anything else.
 */
export const readCodexCatalogue = (input: {
  readonly paths: readonly string[];
  readonly read: (path: string) => string | undefined;
}): CodexCatalogue => {
  for (const path of input.paths) {
    let raw: string | undefined;
    try {
      raw = input.read(path);
    } catch (error) {
      return {
        available: false,
        looked: input.paths,
        why: `'${path}' cannot be read: ${(error as Error).message}`,
      };
    }
    if (raw === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        available: false,
        looked: input.paths,
        why: `'${path}' is not JSON: ${(error as Error).message}`,
      };
    }
    const shaped = cacheSchema.safeParse(parsed);
    if (!shaped.success) {
      return {
        available: false,
        looked: input.paths,
        why: `'${path}' is not the vendor's model cache: no readable 'models' with a 'slug' each`,
      };
    }
    const levels = new Map<string, readonly string[]>();
    for (const model of shaped.data.models) {
      levels.set(
        model.slug,
        (model.supported_reasoning_levels ?? []).map((level) => level.effort),
      );
    }
    return {
      available: true,
      source: path,
      clientVersion: shaped.data.client_version ?? "(no client_version)",
      fetchedAt: shaped.data.fetched_at ?? "(no fetched_at)",
      levels,
    };
  }
  return {
    available: false,
    looked: input.paths,
    why: "no such file — the vendor's CLI has never run here (a CI runner has no such file)",
  };
};

/** The four states of one pair, named so a caller can print each differently. */
export type CodexPairVerdict =
  | { readonly verdict: "supported"; readonly supported: readonly string[] }
  | { readonly verdict: "unsupported"; readonly supported: readonly string[] }
  | { readonly verdict: "unknown-model"; readonly known: readonly string[] }
  | { readonly verdict: "no-catalogue" };

/**
 * THE JUDGEMENT, and it is deliberately narrow: only a model the list NAMES can have a
 * level denied. A model with an empty level list is `unknown-model` in everything but the
 * word — the vendor told us nothing about it — so it is answered as such rather than
 * refusing every level of it.
 */
export const judgeCodexPair = (input: {
  readonly catalogue: CodexCatalogue;
  readonly model: string;
  readonly effort: string;
}): CodexPairVerdict => {
  if (!input.catalogue.available) return { verdict: "no-catalogue" };
  const supported = input.catalogue.levels.get(input.model);
  if (supported === undefined || supported.length === 0) {
    return { verdict: "unknown-model", known: [...input.catalogue.levels.keys()] };
  }
  return supported.includes(input.effort)
    ? { verdict: "supported", supported }
    : { verdict: "unsupported", supported };
};

/** One sentence about one card, and whether it is a refusal or a note the door prints beside its verdict. */
export type CodexPairFinding = {
  readonly roleId: string;
  /** `true` — `config check` refuses; `false` — it prints the line and still passes. */
  readonly fatal: boolean;
  readonly line: string;
};

/** The card as this door reads it: only a codex card that names BOTH halves has a pair at all. */
export type CodexPairCard = {
  readonly roleId: string;
  readonly model: string;
  readonly effort: string;
};

const listed = (values: readonly string[]): string =>
  values.length === 0 ? "(none)" : values.join(", ");

const provenance = (catalogue: Extract<CodexCatalogue, { available: true }>): string =>
  `source: ${catalogue.source}, codex-cli ${catalogue.clientVersion}, fetched ${catalogue.fetchedAt}`;

/**
 * The words, in one place because they are the deliverable: what a reader sees is what
 * tells the three states apart, and a test that pins the wording is pinning the contract.
 */
export const describeCodexPair = (input: {
  readonly card: CodexPairCard;
  readonly catalogue: CodexCatalogue;
}): CodexPairFinding | undefined => {
  const { card, catalogue } = input;
  const pair = `model '${card.model}' × effort '${card.effort}'`;
  const judged = judgeCodexPair({ catalogue, model: card.model, effort: card.effort });

  switch (judged.verdict) {
    case "supported":
      return undefined;
    case "unsupported":
      // Only reachable with a list in hand, which is what makes this one a refusal: the
      // vendor's own file says the level is not on that model, so the run is dead before
      // it is paid for.
      return {
        roleId: card.roleId,
        fatal: true,
        line: `role '${card.roleId}': ${pair} — the vendor's list gives '${card.model}' the levels ${listed(
          judged.supported,
        )}, and '${card.effort}' is not among them: the enum passes the word and the run dies at the vendor with the lease spent (${provenance(
          catalogue as Extract<CodexCatalogue, { available: true }>,
        )})`,
      };
    case "unknown-model":
      return {
        roleId: card.roleId,
        fatal: false,
        line: `role '${card.roleId}': ${pair} NOT JUDGED — the vendor's list does not name '${card.model}' (it names ${listed(
          judged.known,
        )}), so this door says nothing about the pair: a cache can be stale and a catalogue changes without us (${provenance(
          catalogue as Extract<CodexCatalogue, { available: true }>,
        )})`,
      };
    case "no-catalogue":
      return {
        roleId: card.roleId,
        fatal: false,
        line: `role '${card.roleId}': ${pair} NOT CHECKED — there is no vendor model list on this box, so the pair is unjudged rather than approved (looked at ${listed(
          (catalogue as Extract<CodexCatalogue, { available: false }>).looked,
        )}; ${(catalogue as Extract<CodexCatalogue, { available: false }>).why})`,
      };
  }
};

/**
 * Every finding of a config, in the order of its roles. A card naming a model and no
 * effort (or an effort and no model) is passed over in silence ON PURPOSE: the unsaid half
 * is the vendor's own default, this package does not know what it resolves to, and a note
 * about a pair that does not exist is noise on a healthy config.
 */
export const codexPairFindings = (input: {
  readonly roles: readonly {
    readonly id: string;
    readonly launch?:
      | {
          readonly agent?:
            | {
                readonly kind: string;
                readonly model?: string | undefined;
                readonly effort?: string | undefined;
              }
            | undefined;
        }
      | undefined;
  }[];
  readonly catalogue: CodexCatalogue;
}): readonly CodexPairFinding[] => {
  const findings: CodexPairFinding[] = [];
  for (const role of input.roles) {
    const agent = role.launch?.agent;
    if (agent === undefined || agent.kind !== "codex") continue;
    if (agent.model === undefined || agent.effort === undefined) continue;
    const finding = describeCodexPair({
      card: { roleId: role.id, model: agent.model, effort: agent.effort },
      catalogue: input.catalogue,
    });
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
};
