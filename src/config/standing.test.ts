import { describe, expect, it } from "vitest";

import { RoleConfigError } from "../roles/registry.js";
import { compareProtocolVersion, ProtocolVersionError } from "../schema/version.js";
import type { LoadedConfig } from "./load.js";
import { createStandingConfig, standingKey } from "./standing.js";

/** Only identity matters here — the memory stores whatever the door returned, unread. */
const loaded = (marker: string): LoadedConfig =>
  ({ path: marker, ref: "origin/main" }) as unknown as LoadedConfig;

const at = (iso: string) => (): Date => new Date(iso);

describe("createStandingConfig", () => {
  it("the FIRST read fails through: there is nothing to stand on", () => {
    const standing = createStandingConfig();

    const outcome = standing.read("k", () => {
      throw new Error("git fetch: Connection timed out");
    });

    // The startup read of the daemon is this case, and it must stay fatal: without a
    // single config ever read there is nothing to work by.
    expect(outcome.kind).toBe("unread");
    if (outcome.kind !== "unread") throw new Error("unreachable");
    expect(outcome.error.message).toContain("Connection timed out");
  });

  it("a read that cannot reach the ref stands on the last one, naming what failed and how old it is", () => {
    const standing = createStandingConfig({ now: at("2026-07-28T22:00:00.000Z") });
    expect(standing.read("k", () => loaded("first")).kind).toBe("read");

    const outcome = standing.read("k", () => {
      throw new Error("git fetch --quiet origin main: ssh: connect to host github.com port 22");
    });

    expect(outcome.kind).toBe("stood");
    if (outcome.kind !== "stood") throw new Error("unreachable");
    expect(outcome.config.path).toBe("first");
    // All three facts a human needs at 3am: what failed, that nothing new was read,
    // and how old what we are working by is.
    expect(outcome.reason).toContain("ssh: connect to host github.com port 22");
    expect(outcome.reason).toContain("2026-07-28T22:00:00.000Z");
    expect(outcome.reason).toContain("nothing new was read");
  });

  it("keeps standing on the SAME config while the wire stays down — the tick is the retry", () => {
    const standing = createStandingConfig();
    standing.read("k", () => loaded("first"));

    const first = standing.read("k", () => {
      throw new Error("down");
    });
    const second = standing.read("k", () => {
      throw new Error("still down");
    });

    expect(first.kind).toBe("stood");
    expect(second.kind).toBe("stood");
    if (second.kind !== "stood") throw new Error("unreachable");
    // A failed read never becomes the standing one: otherwise the memory would decay
    // into whatever the last exception happened to be.
    expect(second.config.path).toBe("first");
  });

  it("the wire coming back replaces what stands — no restart, no human", () => {
    const standing = createStandingConfig();
    standing.read("k", () => loaded("first"));
    standing.read("k", () => {
      throw new Error("down");
    });

    const back = standing.read("k", () => loaded("second"));
    const later = standing.read("k", () => {
      throw new Error("down again");
    });

    expect(back.kind).toBe("read");
    if (later.kind !== "stood") throw new Error("unreachable");
    expect(later.config.path).toBe("second");
  });

  it("a REJECTED config is never stood over — a schema complaint is the repository's own statement", () => {
    const standing = createStandingConfig();
    standing.read("k", () => loaded("first"));

    const outcome = standing.read("k", () => {
      throw new RoleConfigError(["roles.0.id: Required"]);
    });

    // Carrying on with yesterday's config here would override a decision somebody
    // pushed, rather than survive a hiccup of the wire.
    expect(outcome.kind).toBe("unread");
  });

  it("a version verdict is never stood over either — it is exactly what must stop the process", () => {
    const standing = createStandingConfig();
    standing.read("k", () => loaded("first"));

    const outcome = standing.read("k", () => {
      throw new ProtocolVersionError(compareProtocolVersion(999), {
        path: "p",
        ref: "origin/main",
      });
    });

    expect(outcome.kind).toBe("unread");
    if (outcome.kind !== "unread") throw new Error("unreachable");
    expect(outcome.error.message).toContain("restart required");
  });

  it("the memory is per QUESTION: another ref does not answer from this one's config", () => {
    const standing = createStandingConfig();
    standing.read(standingKey({ repo: "/r", ref: "origin/main", path: "c.json" }), () =>
      loaded("main"),
    );

    const outcome = standing.read(standingKey({ repo: "/r", ref: "HEAD", path: "c.json" }), () => {
      throw new Error("down");
    });

    // Answering "what does HEAD say" out of what origin/main said would be a wrong
    // answer dressed as resilience.
    expect(outcome.kind).toBe("unread");
  });

  it("the key separates repository, ref and path", () => {
    expect(standingKey({ repo: "/a", ref: "origin/main", path: "c.json" })).not.toBe(
      standingKey({ repo: "/a", ref: "origin/mainc.json", path: "" }),
    );
  });
});
