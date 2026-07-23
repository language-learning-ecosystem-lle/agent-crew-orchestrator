/**
 * Предыдущее состояние ленты — из git.
 *
 * Проверка неизменности сообщений не может опираться на диск: на диске лежит
 * только «сейчас». Вопрос «менялся ли ранее закоммиченный файл» имеет смысл
 * лишь относительно точки в истории, и единственный, кто её знает, — git.
 *
 * Почему это не нарушает границу слоёв: ядро (`thread/`) остаётся функциями
 * «строка → строка» и о git не знает; `checkImmutable` принимает две карты
 * «путь → содержимое». Здесь — тонкая обёртка, добывающая вторую карту.
 *
 * Отказ громкий: не тот ref, не репозиторий, нет git в PATH — исключение с
 * текстом, а не пустая карта. Пустая карта означала бы «ничего не менялось», то
 * есть проверка молча превратилась бы в свою противоположность.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";

const git = (root: string, args: readonly string[]): string => {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`git ${args.join(" ")} в '${root}': ${(error as Error).message}`);
  }
};

const MESSAGE_PATH = /\/messages\/[^/]+\.md$/;

/**
 * Файлы сообщений на момент `ref`, ключ — путь относительно `root`
 * (тот же вид, что у путей на диске, иначе карты не сравнить).
 */
export const messagesAtRef = (root: string, ref: string): Map<string, string> => {
  // Все git-вызовы идут ОТ КОРНЯ РЕПОЗИТОРИЯ, а не от каталога почты: pathspec
  // и вывод `ls-tree` резолвятся относительно текущей директории, и запуск из
  // подкаталога давал пустой список — то есть «ничего не менялось» вместо
  // ответа. Поймано тестом, а не рассуждением.
  const top = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const prefix = relative(top, realpathSync(root));

  const listed = git(top, ["ls-tree", "-r", "--name-only", "--full-name", ref, "--", prefix || "."])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && MESSAGE_PATH.test(line));

  const files = new Map<string, string>();
  for (const path of listed) {
    const key = prefix === "" ? path : relative(prefix, path);
    files.set(key, git(top, ["show", `${ref}:${path}`]));
  }
  return files;
};
