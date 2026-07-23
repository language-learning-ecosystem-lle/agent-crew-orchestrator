import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkImmutable } from "../thread/check.js";
import { messagesAtRef } from "./git.js";

const git = (repo: string, ...args: string[]): void => {
  execFileSync(
    "git",
    ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { encoding: "utf8" },
  );
};

/** Репозиторий с одним сообщением в треде, закоммиченным один раз. */
const repoWithMessage = (): { root: string; file: string } => {
  const repo = mkdtempSync(join(tmpdir(), "agent-protocol-git-"));
  const root = join(repo, "agent-comms");
  const file = join(root, "012-x", "messages", "2026-07-23T13-45-12Z-dev-core.md");

  mkdirSync(join(root, "012-x", "messages"), { recursive: true });
  writeFileSync(
    file,
    "---\nfrom: dev-core\ndate: 2026-07-23T13:45:12Z\nexpects: none\n---\n\nБыло.\n",
  );

  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "первое сообщение");

  return { root, file };
};

describe("messagesAtRef", () => {
  it("отдаёт содержимое сообщений на момент ref, ключом — путь относительно корня почты", () => {
    const { root } = repoWithMessage();

    const files = messagesAtRef(root, "HEAD");

    expect([...files.keys()]).toEqual(["012-x/messages/2026-07-23T13-45-12Z-dev-core.md"]);
    expect(files.values().next().value).toContain("Было.");
  });

  it("вместе с checkImmutable ловит правку задним числом", () => {
    // Ради этой связки git-слой и существует: на диске лежит только «сейчас»,
    // и без точки в истории вопрос «правили ли задним числом» не имеет смысла.
    const { root, file } = repoWithMessage();
    const previous = messagesAtRef(root, "HEAD");

    writeFileSync(file, readFileSync(file, "utf8").replace("Было.", "Стало."));
    const current = new Map(
      [...previous.keys()].map((key) => [key, readFileSync(join(root, key), "utf8")]),
    );

    expect(checkImmutable(previous, current).map((issue) => issue.message)).toEqual([
      "файл сообщения изменён после коммита — правка задним числом",
    ]);
  });

  it("на несуществующем ref падает громко, а не отдаёт пустую карту", () => {
    // Пустая карта означала бы «ничего не менялось» — проверка превратилась бы
    // в свою противоположность ровно там, где она нужна.
    const { root } = repoWithMessage();

    expect(() => messagesAtRef(root, "no-such-ref")).toThrow(/git/);
  });
});
