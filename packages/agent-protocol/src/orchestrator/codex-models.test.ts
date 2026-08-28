/**
 * THE TABLE OF PAIRS, which is the whole of the decision (thread `041-model-effort-pair`).
 *
 * THE VENDOR'S LIST IS A FIXTURE HERE AND DELIBERATELY NOT A SNAPSHOT. Its contents are
 * live — models arrive and levels move without this repository being told — so a test that
 * pinned today's six models would be checking history within a month. What is pinned is the
 * SHAPE the vendor writes and the four answers this door gives about it; that the real file
 * still has that shape is measured by a human on a box where it lives, and by the source
 * being named in every sentence the door prints so any reader can check it by hand.
 */
import { describe, expect, it } from "vitest";

import {
  CODEX_MODELS_CACHE,
  type CodexCatalogue,
  codexCataloguePaths,
  codexPairFindings,
  describeCodexPair,
  judgeCodexPair,
  readCodexCatalogue,
} from "./codex-models.js";

/** The vendor's file as it is written, cut to the keys this reader claims. */
const CACHE = JSON.stringify({
  fetched_at: "2026-08-28T20:19:04.947791931Z",
  client_version: "0.150.1",
  models: [
    {
      slug: "wide-model",
      supported_reasoning_levels: [
        { effort: "low", description: "…" },
        { effort: "medium", description: "…" },
        { effort: "high", description: "…" },
        { effort: "xhigh", description: "…" },
        { effort: "max", description: "…" },
      ],
    },
    {
      slug: "narrow-model",
      supported_reasoning_levels: [
        { effort: "low", description: "…" },
        { effort: "medium", description: "…" },
        { effort: "high", description: "…" },
        { effort: "xhigh", description: "…" },
      ],
    },
  ],
});

const at = (path: string, body: string | undefined) => (asked: string) =>
  asked === path ? body : undefined;

const catalogueOf = (body: string | undefined): CodexCatalogue =>
  readCodexCatalogue({
    paths: ["/box/.codex/models_cache.json"],
    read: at("/box/.codex/models_cache.json", body),
  });

const card = (model: string, effort: string) => ({ roleId: "pilot-codex", model, effort });

describe("where the vendor's list is looked for", () => {
  it("CODEX_HOME wins — the box with two accounts has two homes", () => {
    expect(codexCataloguePaths({ codexHome: "/accounts/second", homeDir: "/home/lle" })).toEqual([
      `/accounts/second/${CODEX_MODELS_CACHE}`,
    ]);
  });

  it("unset or empty falls back to the vendor's own default", () => {
    expect(codexCataloguePaths({ codexHome: undefined, homeDir: "/home/lle" })).toEqual([
      `/home/lle/.codex/${CODEX_MODELS_CACHE}`,
    ]);
    expect(codexCataloguePaths({ codexHome: "   ", homeDir: "/home/lle" })).toEqual([
      `/home/lle/.codex/${CODEX_MODELS_CACHE}`,
    ]);
  });
});

describe("reading the list", () => {
  it("carries the provenance, not only the levels", () => {
    const catalogue = catalogueOf(CACHE);
    expect(catalogue.available).toBe(true);
    if (!catalogue.available) return;
    expect(catalogue.source).toBe("/box/.codex/models_cache.json");
    expect(catalogue.clientVersion).toBe("0.150.1");
    expect(catalogue.fetchedAt).toBe("2026-08-28T20:19:04.947791931Z");
    expect(catalogue.levels.get("narrow-model")).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("A MISSING FILE IS A NAMED STATE, not an empty list — the two are opposite verdicts", () => {
    const catalogue = catalogueOf(undefined);
    expect(catalogue.available).toBe(false);
    if (catalogue.available) return;
    expect(catalogue.looked).toEqual(["/box/.codex/models_cache.json"]);
    expect(catalogue.why).toContain("no such file");
  });

  it("a file that is not JSON, and one that is JSON of another shape, both say which", () => {
    const broken = catalogueOf("{ not json");
    expect(broken.available).toBe(false);
    if (!broken.available) expect(broken.why).toContain("is not JSON");

    const alien = catalogueOf(JSON.stringify({ models: [{ name: "no slug here" }] }));
    expect(alien.available).toBe(false);
    if (!alien.available) expect(alien.why).toContain("not the vendor's model cache");
  });

  it("an unreadable file is not confused with an absent one", () => {
    const catalogue = readCodexCatalogue({
      paths: ["/box/.codex/models_cache.json"],
      read: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(catalogue.available).toBe(false);
    if (!catalogue.available) expect(catalogue.why).toContain("EACCES");
  });
});

describe("the pair itself", () => {
  it("a level the model carries is supported", () => {
    expect(
      judgeCodexPair({ catalogue: catalogueOf(CACHE), model: "narrow-model", effort: "low" }),
    ).toEqual({
      verdict: "supported",
      supported: ["low", "medium", "high", "xhigh"],
    });
  });

  it("A LEVEL THE VOCABULARY HAS AND THE MODEL DOES NOT — the hole this door was opened for", () => {
    expect(
      judgeCodexPair({ catalogue: catalogueOf(CACHE), model: "narrow-model", effort: "max" }),
    ).toEqual({
      verdict: "unsupported",
      supported: ["low", "medium", "high", "xhigh"],
    });
    // The SAME level on a model that carries it stays supported: the verdict is about the
    // pair, and a word is not condemned by one model's absence of it.
    expect(
      judgeCodexPair({ catalogue: catalogueOf(CACHE), model: "wide-model", effort: "max" }).verdict,
    ).toBe("supported");
  });

  it("a model the list does not name is UNJUDGED, not refused", () => {
    const judged = judgeCodexPair({
      catalogue: catalogueOf(CACHE),
      model: "gpt-5-codex",
      effort: "low",
    });
    expect(judged.verdict).toBe("unknown-model");
    if (judged.verdict === "unknown-model")
      expect(judged.known).toEqual(["wide-model", "narrow-model"]);
  });

  it("a model named with no levels at all is the same unjudged state — the vendor told us nothing", () => {
    const catalogue = catalogueOf(
      JSON.stringify({ client_version: "0.150.1", models: [{ slug: "mystery" }] }),
    );
    expect(judgeCodexPair({ catalogue, model: "mystery", effort: "max" }).verdict).toBe(
      "unknown-model",
    );
  });

  it("no list at all is its own verdict and never 'supported'", () => {
    expect(
      judgeCodexPair({ catalogue: catalogueOf(undefined), model: "narrow-model", effort: "max" }),
    ).toEqual({ verdict: "no-catalogue" });
  });
});

describe("the words, which are the contract", () => {
  it("the refusal carries BOTH halves of the pair, the levels that model has, and the source", () => {
    const said = describeCodexPair({
      card: card("narrow-model", "max"),
      catalogue: catalogueOf(CACHE),
    });
    expect(said?.fatal).toBe(true);
    expect(said?.line).toContain("model 'narrow-model' × effort 'max'");
    expect(said?.line).toContain("low, medium, high, xhigh");
    expect(said?.line).toContain("/box/.codex/models_cache.json");
    expect(said?.line).toContain("fetched 2026-08-28T20:19:04.947791931Z");
  });

  it("'the list is missing' is NOT fatal and does not read as approval", () => {
    const said = describeCodexPair({
      card: card("narrow-model", "max"),
      catalogue: catalogueOf(undefined),
    });
    expect(said?.fatal).toBe(false);
    expect(said?.line).toContain("NOT CHECKED");
    expect(said?.line).toContain("looked at /box/.codex/models_cache.json");
  });

  it("'the model is unknown' is a THIRD sentence — the reader can tell which of the two happened", () => {
    const said = describeCodexPair({
      card: card("gpt-5-codex", "low"),
      catalogue: catalogueOf(CACHE),
    });
    expect(said?.fatal).toBe(false);
    expect(said?.line).toContain("NOT JUDGED");
    expect(said?.line).not.toContain("NOT CHECKED");
  });

  it("a healthy pair says NOTHING — a door that comments on health is noise", () => {
    expect(
      describeCodexPair({ card: card("narrow-model", "low"), catalogue: catalogueOf(CACHE) }),
    ).toBeUndefined();
  });
});

describe("a whole config", () => {
  const roles = [
    { id: "john" },
    {
      id: "dev-core",
      launch: { agent: { kind: "claude-code", model: "claude-opus-5", effort: "max" } },
    },
    {
      id: "pilot-codex",
      launch: { agent: { kind: "codex", model: "narrow-model", effort: "max" } },
    },
    { id: "half-said", launch: { agent: { kind: "codex", model: "narrow-model" } } },
  ];

  it("judges the codex cards that name both halves, and only those", () => {
    const findings = codexPairFindings({ roles, catalogue: catalogueOf(CACHE) });
    expect(findings.map((finding) => finding.roleId)).toEqual(["pilot-codex"]);
    expect(findings[0]?.fatal).toBe(true);
  });

  it("THE OTHER TOOL IS NOT JUDGED HERE, and that asymmetry is measured rather than assumed: no list of claude-code models exists on the box to judge against", () => {
    const findings = codexPairFindings({
      roles: [
        {
          id: "dev-core",
          launch: { agent: { kind: "claude-code", model: "narrow-model", effort: "max" } },
        },
      ],
      catalogue: catalogueOf(CACHE),
    });
    expect(findings).toEqual([]);
  });
});
