import { describe, expect, it } from "vitest";

import { type CommandFlags, parseUsage, strayArguments } from "./argv.js";

const USAGE = `
usage:
  agent-protocol orchestrator daemon --ref <ref> [--repo <p>] [--tick <sec>] [--once]
                              # a comment line that is not a command
  agent-protocol orchestrator hold   --mode take    --ref <ref> --role <id> [--write]
  agent-protocol orchestrator hold   <role> [--by <who>] [--ttl <sec>]
  agent-protocol orchestrator run    --ref <ref> [--fresh] [--write] [-d|--detach]
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
});
