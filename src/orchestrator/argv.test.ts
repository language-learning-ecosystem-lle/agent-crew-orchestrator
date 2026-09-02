import { describe, expect, it } from "vitest";

import { type CommandFlags, parseUsage, strayArguments } from "./argv.js";

const USAGE = `
usage:
  agent-protocol orchestrator daemon --ref <ref> [--repo <p>] [--tick <sec>] [--once]
                              # a comment line that is not a command
  agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> [--write]
  agent-protocol orchestrator hold   <role> [--by <who>] [--ttl <sec>]
  agent-protocol orchestrator run    --ref <ref> [--fresh] [--write] [-d|--detach]
  agent-protocol orchestrator up     [--ref <ref>] [--clear-force]   # plus every 'daemon' flag
  agent-protocol zones check  --ref <ref> (--role <id> | --role-from-workspace) (--staged | --base <ref>)
`;

const spec = (key: string): CommandFlags => {
  const found = parseUsage(USAGE).get(key);
  if (found === undefined) throw new Error(`no spec for '${key}'`);
  return found;
};

describe("parseUsage", () => {
  it("reads the flags of a command off its usage line", () => {
    const daemon = spec("orchestrator daemon");
    expect(daemon.value).toContain("--ref");
    expect(daemon.value).toContain("--tick");
    expect(daemon.boolean).toContain("--once");
    expect(daemon.positionals).toBe(0);
  });

  it("takes alternatives in one bracket as separate switches", () => {
    const run = spec("orchestrator run");
    expect(run.boolean).toContain("-d");
    expect(run.boolean).toContain("--detach");
    expect(run.boolean).toContain("--write");
  });

  it("unions several lines of one command and keeps its positional", () => {
    const hold = spec("orchestrator hold");
    expect(hold.value).toContain("--mode");
    expect(hold.value).toContain("--by");
    expect(hold.boolean).toContain("--write");
    expect(hold.positionals).toBe(1);
  });

  it("lets the flags of the config loader through everywhere", () => {
    expect(spec("orchestrator run").boolean).toContain("--no-fetch");
    expect(spec("orchestrator run").value).toContain("--repo");
  });

  /**
   * PUNCTUATION IS NOT A VALUE (thread 042). Both cases are asserted on the
   * CLASSIFICATION — `value` against `boolean` — and not on the flag being named
   * somewhere, because "named somewhere" is exactly what the shipped tests asked
   * before and what let both defects through: the flag WAS in the table, on the
   * wrong side of it.
   */
  it("does not read the `|` between two alternatives as the value of the first", () => {
    const zones = spec("zones check");
    expect(zones.boolean).toContain("--staged");
    expect(zones.value).not.toContain("--staged");
    // The other member of the same bracket still takes its placeholder.
    expect(zones.value).toContain("--base");
    expect(zones.boolean).toContain("--role-from-workspace");
    expect(zones.value).toContain("--role");
  });

  it("does not read the tail comment of a usage line as the value of the last flag", () => {
    const up = spec("orchestrator up");
    expect(up.boolean).toContain("--clear-force");
    expect(up.value).not.toContain("--clear-force");
  });

  it("keeps no token of a tail comment in the table at all", () => {
    const up = spec("orchestrator up");
    const named = [...up.value, ...up.boolean];
    for (const word of ["#", "plus", "every", "'daemon'", "flag", "|"])
      expect(named).not.toContain(word);
  });

  it("still reads a bare literal after a flag as its value", () => {
    // The repair is about punctuation, not about literals: `--mode take` is grammar
    // the usage text declares, and a fix that took it away would refuse a legal call.
    expect(spec("orchestrator hold").value).toContain("--mode");
    expect(spec("orchestrator hold").boolean).not.toContain("--mode");
  });
});

describe("strayArguments", () => {
  const daemon = spec("orchestrator daemon");

  it("says nothing about a clean invocation", () => {
    expect(strayArguments(["--ref", "origin/main", "--once"], daemon)).toEqual([]);
  });

  it("does not read a flag's value as an argument of its own", () => {
    // `--tick -5` is nonsense the parser of the value will judge; the point here is
    // that the checker must not report it twice.
    expect(strayArguments(["--tick", "-5"], daemon)).toEqual([]);
  });

  it("catches the flag the daemon used to swallow", () => {
    const problems = strayArguments(["--ref", "HEAD", "-d"], daemon);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("-d");
  });

  it("names the '--flag=value' spelling instead of calling it unknown", () => {
    const [problem] = strayArguments(["--ref=HEAD"], daemon);
    expect(problem).toContain("--ref <value>");
  });

  it("catches a value flag left at the end of the line with nothing after it", () => {
    const [problem] = strayArguments(["--once", "--ref"], daemon);
    expect(problem).toContain("expects a value");
  });

  it("refuses a bare argument to a command that declares none", () => {
    const [problem] = strayArguments(["curator"], daemon);
    expect(problem).toContain("takes no such argument");
  });

  it("allows the bare argument of a command that declares one", () => {
    expect(strayArguments(["curator", "--ttl", "3600"], spec("orchestrator hold"))).toEqual([]);
    const [problem] = strayArguments(["curator", "dev-core"], spec("orchestrator hold"));
    expect(problem).toContain("dev-core");
  });

  /**
   * What the misclassification COST at the door, asserted rather than derived from the
   * table: a switch read as a value flag refuses the invocation the usage line offers,
   * and then eats the next token — so the typo behind it goes through in silence, which
   * is the very defect this module was written against.
   */
  it("lets a switch stand last on the line, and catches the typo behind it", () => {
    const up = spec("orchestrator up");
    expect(strayArguments(["--clear-force"], up)).toEqual([]);
    const problems = strayArguments(["--clear-force", "--forgeround"], up);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--forgeround");
  });
});
