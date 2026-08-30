/**
 * WHAT IS CHECKED HERE (thread 065, «Проверяемость»): the config names the file → the
 * variable reaches the child call; a variable already set is NOT overwritten; no file /
 * no key / an unreadable file are THREE refusals, each naming the path it tried to read;
 * and no value of a secret appears in any string this module produces.
 */
import { describe, expect, it } from "vitest";
import { describePlatformEnv, PLATFORM_TOKEN_KEYS, platformEnvFrom } from "./credentials.js";

const SECRET = "ghp_do_not_print_me_0123456789";

const reader =
  (files: Record<string, string>) =>
  (path: string): { readonly raw: string } | { readonly error: NodeJS.ErrnoException } => {
    const raw = files[path];
    if (raw === undefined) {
      const error = new Error(
        `ENOENT: no such file or directory, open '${path}'`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      return { error };
    }
    if (raw === "<denied>") {
      const error = new Error(`EACCES: permission denied, open '${path}'`) as NodeJS.ErrnoException;
      error.code = "EACCES";
      return { error };
    }
    return { raw };
  };

describe("platformEnvFrom", () => {
  it("takes the token from the file the config names and hands it to the child call", () => {
    const answer = platformEnvFrom({
      secretsPath: "/etc/aco/secrets.aco.env",
      configPath: "/home/lle/.config/agent-protocol/instances/hetzner.json",
      env: { PATH: "/usr/bin" },
      read: reader({ "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\n` }),
    });

    expect(answer.env.GH_TOKEN).toBe(SECRET);
    expect(answer.token).toEqual({ key: "GH_TOKEN", from: "file" });
    expect(answer.refusal).toBeNull();
  });

  it("hands the child EVERY variable of the file, not only the token", () => {
    const answer = platformEnvFrom({
      secretsPath: "/etc/aco/secrets.aco.env",
      configPath: "/etc/aco/local.json",
      env: {},
      read: reader({
        "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\nexport TELEGRAM_BOT_TOKEN="t-42"\n# a comment\n`,
      }),
    });

    expect(answer.env.TELEGRAM_BOT_TOKEN).toBe("t-42");
    expect(answer.file).toEqual({
      kind: "read",
      path: "/etc/aco/secrets.aco.env",
      names: ["GH_TOKEN", "TELEGRAM_BOT_TOKEN"],
    });
  });

  it("does NOT overwrite a variable the caller already set — the debug path wins", () => {
    const answer = platformEnvFrom({
      secretsPath: "/etc/aco/secrets.aco.env",
      configPath: "/etc/aco/local.json",
      env: { GH_TOKEN: "the-callers-own-token" },
      read: reader({ "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\n` }),
    });

    expect(answer.env.GH_TOKEN).toBe("the-callers-own-token");
    expect(answer.token).toEqual({ key: "GH_TOKEN", from: "environment" });
    expect(answer.refusal).toBeNull();
  });

  it("accepts GITHUB_TOKEN as the login too — the list is the one gh reads", () => {
    expect(PLATFORM_TOKEN_KEYS).toEqual(["GH_TOKEN", "GITHUB_TOKEN"]);
    const answer = platformEnvFrom({
      secretsPath: null,
      configPath: "/etc/aco/local.json",
      env: { GITHUB_TOKEN: "t" },
    });
    expect(answer.token).toEqual({ key: "GITHUB_TOKEN", from: "environment" });
    expect(answer.refusal).toBeNull();
  });

  it("turns off git's prompt for every child, with a token or without one", () => {
    const withToken = platformEnvFrom({
      secretsPath: null,
      configPath: "/etc/aco/local.json",
      env: { GH_TOKEN: "t" },
    });
    const without = platformEnvFrom({
      secretsPath: null,
      configPath: "/etc/aco/local.json",
      env: {},
    });

    expect(withToken.env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(without.env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("hands git a credential helper that reads the token from its own environment", () => {
    const answer = platformEnvFrom({
      secretsPath: "/etc/aco/secrets.aco.env",
      configPath: "/etc/aco/local.json",
      env: {},
      read: reader({ "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\n` }),
    });

    expect(answer.env.GIT_CONFIG_COUNT).toBe("1");
    expect(answer.env.GIT_CONFIG_KEY_0).toBe("credential.https://github.com.helper");
    // The VALUE of the token is not in the helper — only the NAME of the variable it reads.
    expect(answer.env.GIT_CONFIG_VALUE_0).toContain("$GH_TOKEN");
    expect(answer.env.GIT_CONFIG_VALUE_0).not.toContain(SECRET);
  });

  it("appends to a GIT_CONFIG_COUNT the caller already set instead of overwriting entry 0", () => {
    const answer = platformEnvFrom({
      secretsPath: null,
      configPath: "/etc/aco/local.json",
      env: { GH_TOKEN: "t", GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "user.name" },
    });

    expect(answer.env.GIT_CONFIG_COUNT).toBe("3");
    expect(answer.env.GIT_CONFIG_KEY_2).toBe("credential.https://github.com.helper");
    expect(answer.env.GIT_CONFIG_KEY_0).toBe("user.name");
  });

  describe("the refusal says which file and why — never 'populate the GH_TOKEN'", () => {
    it("no file named: the machine config is quoted and told what to add", () => {
      const answer = platformEnvFrom({
        secretsPath: null,
        configPath: "/home/lle/.config/agent-protocol/instances/hetzner.json",
        env: {},
      });

      expect(answer.token).toBeNull();
      expect(answer.refusal).toContain("/home/lle/.config/agent-protocol/instances/hetzner.json");
      expect(answer.refusal).toContain("names no 'secrets.envFile'");
    });

    it("the file is absent: the PATH it tried to read is in the refusal", () => {
      const answer = platformEnvFrom({
        secretsPath: "/etc/aco/secrets.aco.env",
        configPath: "/etc/aco/local.json",
        env: {},
        read: reader({}),
      });

      expect(answer.file).toEqual({ kind: "absent", path: "/etc/aco/secrets.aco.env" });
      expect(answer.refusal).toContain("'/etc/aco/secrets.aco.env' named by '/etc/aco/local.json'");
      expect(answer.refusal).toContain("does not exist");
    });

    it("the file cannot be read: a THIRD message, carrying what the box said", () => {
      const answer = platformEnvFrom({
        secretsPath: "/etc/aco/secrets.aco.env",
        configPath: "/etc/aco/local.json",
        env: {},
        read: reader({ "/etc/aco/secrets.aco.env": "<denied>" }),
      });

      expect(answer.file.kind).toBe("unreadable");
      expect(answer.refusal).toContain("could not be read");
      expect(answer.refusal).toContain("EACCES");
      expect(answer.refusal).toContain("/etc/aco/secrets.aco.env");
    });

    it("the file is there and carries no token: the NAMES it does carry are listed", () => {
      const answer = platformEnvFrom({
        secretsPath: "/etc/aco/secrets.aco.env",
        configPath: "/etc/aco/local.json",
        env: {},
        read: reader({ "/etc/aco/secrets.aco.env": `TELEGRAM_BOT_TOKEN=${SECRET}\n` }),
      });

      expect(answer.refusal).toContain("TELEGRAM_BOT_TOKEN");
      expect(answer.refusal).toContain("none of them is GH_TOKEN or GITHUB_TOKEN");
      expect(answer.refusal).not.toContain(SECRET);
    });
  });

  it("never puts a VALUE into the note or the refusal, in any of the cases", () => {
    const cases = [
      platformEnvFrom({
        secretsPath: "/etc/aco/secrets.aco.env",
        configPath: "/etc/aco/local.json",
        env: {},
        read: reader({ "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\nOTHER=${SECRET}\n` }),
      }),
      platformEnvFrom({
        secretsPath: "/etc/aco/secrets.aco.env",
        configPath: "/etc/aco/local.json",
        env: { GH_TOKEN: SECRET },
        read: reader({ "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\n` }),
      }),
      platformEnvFrom({
        secretsPath: "/etc/aco/secrets.aco.env",
        configPath: "/etc/aco/local.json",
        env: {},
        read: reader({ "/etc/aco/secrets.aco.env": `NOTHING_USEFUL=${SECRET}\n` }),
      }),
    ];

    for (const answer of cases) {
      expect(answer.note).not.toContain(SECRET);
      expect(answer.refusal ?? "").not.toContain(SECRET);
      expect(describePlatformEnv({ file: answer.file, token: answer.token })).not.toContain(SECRET);
    }
  });

  it("the note says the file, the names and whose token won", () => {
    const answer = platformEnvFrom({
      secretsPath: "/etc/aco/secrets.aco.env",
      configPath: "/etc/aco/local.json",
      env: {},
      read: reader({ "/etc/aco/secrets.aco.env": `GH_TOKEN=${SECRET}\n` }),
    });

    expect(answer.note).toBe(
      "/etc/aco/secrets.aco.env — GH_TOKEN (values not shown); token GH_TOKEN ← the secrets file",
    );
  });
});
