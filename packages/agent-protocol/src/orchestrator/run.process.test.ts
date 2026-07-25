/**
 * ПРОЦЕССНЫЙ тест наблюдателя — единственное место, где проверяется САМ прогон,
 * а не свёртка журнала.
 *
 * Постановка curator после приёмки 2026-07-25 и находка reviewer-pr по PR #9:
 * инцидент случился в `cli.ts` (супервизор перестал существовать между спавном и
 * терминалом), а тесты били в чистые функции — регрессия вида «`await runOne` снова
 * потеряется» ими не ловится в принципе. Здесь CLI запускается настоящим
 * процессом против настоящего git-контура и проверяется ЖУРНАЛ, а не рапорт.
 *
 * Инвариант, который прибивается: **прогон не заканчивается, не записав исход.**
 * Как именно он закончился — второй вопрос; молча не заканчивается никогда.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseJournal } from "./journal.js";

const CLI = fileURLToPath(new URL("../cli.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../../../node_modules/.bin/tsx", import.meta.url));

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@e", ...args], {
    encoding: "utf8",
  });

const CONFIG = {
  version: 1,
  mail: { branch: "comms", dir: "agent-comms" },
  orchestrator: { state: ".orchestrator", mailCheckout: "mailco", ref: "HEAD" },
  roles: [
    {
      id: "dev-core",
      kind: "claude-code",
      status: "active",
      wake: { mode: "watch", session: "s" },
      summary: "поток",
      instructions: [{ kind: "in-repo", path: "CARD.md" }],
      launch: { allowedTools: ["Bash"] },
    },
  ],
};

const META = "---\ntitle: Т\nparticipants: dev-core, curator\nstatus: open\n---\n";
const WAITING =
  "---\nfrom: curator\ndate: 2026-07-25T10:00:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\nТело.\n";

/**
 * Полный контур на диске: bare-origin, рабочий чекаут с конфигом на `main` и
 * ОТДЕЛЬНЫЙ чекаут почты на ветке `comms` — preflight требует именно этого, и
 * подделать его дешёвым способом значило бы тестировать не то, что работает.
 */
const contour = (): { repo: string; mail: string } => {
  const base = mkdtempSync(join(tmpdir(), "agent-protocol-run-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);

  const repo = join(base, "work");
  execFileSync("git", ["clone", "-q", origin, repo]);
  writeFileSync(join(repo, "agent-protocol.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
  writeFileSync(join(repo, "CARD.md"), "карточка роли\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "конфиг");
  git(repo, "push", "-q", "origin", "main");

  // Ветка почты собирается в ОТДЕЛЬНОМ чекауте — так же, как в живом контуре:
  // почта и код никогда не лежат в одном рабочем дереве.
  const mail = join(repo, "mailco");
  execFileSync("git", ["clone", "-q", origin, mail]);
  git(mail, "checkout", "-q", "--orphan", "comms");
  const thread = join(mail, "agent-comms", "012-x");
  mkdirSync(join(thread, "messages"), { recursive: true });
  writeFileSync(join(thread, "_meta.md"), META);
  writeFileSync(join(thread, "messages", "2026-07-25T10-00-00Z-curator.md"), WAITING);
  git(mail, "add", "agent-comms");
  git(mail, "commit", "-qm", "почта");
  git(mail, "push", "-q", "-u", "origin", "comms");
  return { repo, mail };
};

/** Стаб «сессии»: делает то, что просят, и завершается. */
const stub = (repo: string, body: string): string => {
  const path = join(repo, "stub.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

const run = (repo: string, exec: string): { code: number; out: string } => {
  try {
    const out = execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "20",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe" },
    );
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

const journal = (repo: string): ReturnType<typeof parseJournal> =>
  parseJournal(readFileSync(join(repo, ".orchestrator", "journal.jsonl"), "utf8"));

describe("прогон роли процессом — исход записывается всегда", () => {
  it("сессия ответила → handoff-detected и completed, а не рапорт об успехе", () => {
    const { repo, mail } = contour();
    // Стаб отвечает так же, как живая сессия: пишет файл сообщения в чекаут почты.
    const answer = join(
      mail,
      "agent-comms",
      "012-x",
      "messages",
      "2026-07-25T11-00-00Z-dev-core.md",
    );
    const exec = stub(
      repo,
      `sleep 1\nprintf '%s' '---\nfrom: dev-core\ndate: 2026-07-25T11:00:00Z\nexpects: answer\nwaiting-on: curator\n---\n\nОтвет.\n' > ${answer}`,
    );

    const result = run(repo, exec);
    const kinds = journal(repo).map((event) => event.kind);

    expect(kinds).toEqual(["lease-acquired", "launch", "handoff-detected", "lease-released"]);
    expect(journal(repo).at(-1)).toMatchObject({ reason: "completed" });
    expect(result.code).toBe(0);
  }, 60_000);

  it("сессия вышла, не ответив → exited-without-handoff, аренда закрыта", () => {
    const { repo } = contour();
    const exec = stub(repo, "sleep 1");

    run(repo, exec);
    const events = journal(repo);

    expect(events.map((event) => event.kind)).toEqual([
      "lease-acquired",
      "launch",
      "lease-released",
    ]);
    expect(events.at(-1)).toMatchObject({ reason: "exited-without-handoff" });
  }, 60_000);

  it("дедлайн без ответа → timeout: роль не висит вечно", () => {
    const { repo } = contour();
    const exec = stub(repo, "sleep 120");

    execFileSync(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "3",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, encoding: "utf8", stdio: "pipe" },
    );

    expect(journal(repo).at(-1)).toMatchObject({ reason: "timeout" });
  }, 60_000);

  it("супервизора убили SIGTERM → аренда закрыта supervisor-gone, сессия НЕ осиротела", async () => {
    // Находка reviewer-pr по PR #9: запись «аренда снята» без гашения группы
    // означала бы, что осиротевшая сессия продолжает писать, а связка уже
    // `launchable` — и следующий тик поднял бы ВТОРУЮ сессию поверх живой.
    const { repo } = contour();
    const marker = join(repo, "жив.txt");
    const exec = stub(repo, `sleep 30\ntouch ${marker}`);

    const child = spawn(
      TSX,
      [
        CLI,
        "orchestrator",
        "run",
        "--ref",
        "HEAD",
        "--no-fetch",
        "--repo",
        repo,
        "--role",
        "dev-core",
        "--thread",
        "012-x",
        "--exec",
        exec,
        "--wall-clock",
        "60",
        "--poll",
        "1",
        "--write",
      ],
      { cwd: repo, stdio: "ignore" },
    );
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const last = journal(repo).at(-1);
    expect(last).toMatchObject({ kind: "lease-released", reason: "supervisor-gone" });

    // Сессия должна быть погашена ВМЕСТЕ с наблюдателем: доживи она до конца
    // своих 30 секунд — маркер появился бы.
    await new Promise((resolve) => setTimeout(resolve, 22_000));
    expect(existsSync(marker), "осиротевшая сессия пережила супервизора").toBe(false);
  }, 90_000);

  it("ИНВАРИАНТ: прогон не завершается, оставив аренду живой", () => {
    // Именно это потерялось в приёмке 2026-07-25: процесс закончился, аренда
    // осталась `running`, и снаружи это было неотличимо от работы.
    for (const body of ["sleep 1", "exit 3", "sleep 120"]) {
      const { repo } = contour();
      run(repo, stub(repo, body));
      const last = journal(repo).at(-1);
      expect(last?.kind, `исход не записан для стаба '${body}'`).toBe("lease-released");
    }
  }, 120_000);
});
