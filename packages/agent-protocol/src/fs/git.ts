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

/**
 * Содержимое файла на момент `ref`.
 *
 * Конфиг протокола читается ТОЛЬКО так, а не с диска рабочей копии: worktree
 * агента стоит на его же feature-ветке, и правка прав, лежащая в этой ветке,
 * выглядела бы для контура действующей. Тот же класс, что cwd-слепота (008),
 * только опаснее — он про права.
 */
export const readFileAtRef = (repo: string, ref: string, path: string): string =>
  git(repo, ["show", `${ref}:${path}`]);

/** Есть ли файл на момент `ref`. Нужен для проверки объявленных инструкций ролей. */
export const fileExistsAtRef = (repo: string, ref: string, path: string): boolean => {
  try {
    execFileSync("git", ["-C", repo, "cat-file", "-e", `${ref}:${path}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * Обновить remote-tracking ref перед чтением.
 *
 * `git show origin/main:…` читает локальную копию ветки, которая без fetch
 * протухает МОЛЧА: конфиг месячной давности неотличим от свежего. Поэтому
 * обновление — часть операции чтения, а отказ от него (`--no-fetch`) обязан
 * сопровождаться громкой пометкой у вызывающего.
 */
export const fetchRef = (repo: string, ref: string): void => {
  const at = ref.indexOf("/");
  if (!ref.startsWith("origin/") || at === -1) return;
  git(repo, ["fetch", "--quiet", "origin", ref.slice(at + 1)]);
};

/**
 * Состояние чекаута почты: ветка, чистота, отставание и опережение относительно
 * `origin/<branch>`. Демон читает почту С ДИСКА, поэтому вопрос «свежая ли она»
 * — вопрос про этот чекаут, и ответ на него обязан быть фактом, а не верой.
 *
 * Обновление — ТОЛЬКО fast-forward. `reset --hard` починил бы отставание и
 * заодно стёр бы сообщение, которое роль пишет прямо сейчас; чинить нечужой
 * ценой мы не умеем и не будем — расхождение остаётся отказом.
 */
export const mailCheckoutState = (
  checkout: string,
  branch: string,
): { branch: string; dirty: boolean; behind: number; ahead: number } => {
  git(checkout, ["fetch", "--quiet", "origin", branch]);
  const current = git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (current === branch) {
    // Может не получиться (расхождение, грязь) — это законный исход, его
    // назовёт вердикт по фактам ниже, а не исключение отсюда.
    try {
      git(checkout, ["merge", "--ff-only", "--quiet", `origin/${branch}`]);
    } catch {
      // остаёмся с тем, что есть — счётчики покажут расхождение
    }
  }
  const dirty = git(checkout, ["status", "--porcelain"]).trim() !== "";
  const counts = git(checkout, [
    "rev-list",
    "--left-right",
    "--count",
    `origin/${branch}...HEAD`,
  ]).trim();
  const [behind = "0", ahead = "0"] = counts.split(/\s+/);
  return { branch: current, dirty, behind: Number(behind), ahead: Number(ahead) };
};
