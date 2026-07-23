#!/usr/bin/env node
/**
 * Точка входа для операторов контура.
 *
 *   agent-protocol roles check  --config <roles.json> --doc <ROLES.md>
 *   agent-protocol index build  --root <agent-comms> --config <roles.json> [--write]
 *   agent-protocol thread build --root <agent-comms> --config <roles.json> --id <NNN-slug> [--write]
 *   agent-protocol check        --root <agent-comms> --config <roles.json> [--since <ref>]
 *   agent-protocol migrate      --root <agent-comms> --config <roles.json> [--id <NNN-slug>] [--write]
 *   agent-protocol mail         --root <agent-comms> --config <roles.json> --role <id>
 *
 * Пути ОБЯЗАТЕЛЬНЫ и умолчаний не имеют: умолчание вроде `agent-comms/ROLES.md`
 * было бы знанием о конкретном проекте внутри нейтрального пакета (дисциплина
 * выносимости). Расположение файлов — дело проекта, и документируется у проекта.
 *
 * КАЖДЫЙ ОТКАЗ ГРОМКИЙ. Урок спайка P0: команда, молча зависящая от окружения,
 * даёт результат, неотличимый от дефекта проверяемого — три из трёх сбоев
 * спайка были такими (пропавший файл, проигнорированное имя, PATH). Поэтому
 * нечитаемый файл, кривой JSON и невалидный конфиг — это ненулевой код и текст
 * в stderr, а не пустой вывод.
 *
 * БЕЗ `--write` НИЧЕГО НЕ ПИШЕТСЯ: контур живой, и «посмотреть, что будет»
 * обязано быть дешевле и безопаснее, чем «сделать».
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadThreads } from "./fs/comms.js";
import { messagesAtRef } from "./fs/git.js";
import { loadRoleRegistry, RoleConfigError, type RoleRegistry } from "./roles/registry.js";
import { diffRolesDoc } from "./roles/roles-doc.js";
import { checkImmutable, checkThread } from "./thread/check.js";
import { renderIndex, threadsWaitingOn } from "./thread/index-doc.js";
import { migrateLegacyThread, verifyMigration } from "./thread/migrate.js";
import { renderThread } from "./thread/thread.js";

const USAGE = `usage:
  agent-protocol roles check  --config <roles.json> --doc <ROLES.md>
  agent-protocol index build  --root <agent-comms> --config <roles.json> [--write]
  agent-protocol thread build --root <agent-comms> --config <roles.json> --id <NNN-slug> [--write]
  agent-protocol check        --root <agent-comms> --config <roles.json> [--since <ref>]
  agent-protocol migrate      --root <agent-comms> --config <roles.json> [--id <NNN-slug>] [--write]
  agent-protocol mail         --root <agent-comms> --config <roles.json> --role <id>`;

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const fail = (message: string, code: number): never => {
  err(`agent-protocol: ${message}`);
  process.exit(code);
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const required = (argv: readonly string[], name: string): string =>
  flag(argv, name) ?? fail(`не задан ${name}\n${USAGE}`, 2);

const readFile = (path: string, what: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return fail(`не смог прочитать ${what} '${path}': ${(error as Error).message}`, 2);
  }
};

const registryFrom = (argv: readonly string[]): RoleRegistry => {
  const path = required(argv, "--config");
  const raw = readFile(path, "конфиг ролей");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return fail(`конфиг '${path}' — не JSON: ${(error as Error).message}`, 2);
  }
  try {
    return loadRoleRegistry(parsed);
  } catch (error) {
    if (error instanceof RoleConfigError) return fail(error.message, 2);
    throw error;
  }
};

const writeOut = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

const rolesCheck = (argv: readonly string[]): void => {
  const registry = registryFrom(argv);
  const drift = diffRolesDoc(registry, readFile(required(argv, "--doc"), "документ ролей"));
  if (drift.length === 0) {
    out(
      `agent-protocol: ok — конфиг и документ описывают одни и те же роли (${registry.ids().length})`,
    );
    return;
  }
  err("agent-protocol: конфиг ролей разошёлся с документом:");
  for (const item of drift) err(`- ${item.message}`);
  process.exit(1);
};

const indexBuild = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv);
  const threads = loadThreads(root, registry.ids());
  const rendered = renderIndex(threads.map((loaded) => loaded.thread));
  const path = join(root, "INDEX.md");

  if (argv.includes("--write")) {
    writeOut(path, rendered);
    out(`agent-protocol: INDEX.md перегенерирован из ${threads.length} тредов`);
    return;
  }

  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  if (current === rendered) {
    out("agent-protocol: ok — INDEX.md совпадает с тредами");
    return;
  }
  err("agent-protocol: INDEX.md разошёлся с тредами (--write перезапишет):");
  err(rendered);
  process.exit(1);
};

const threadBuild = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const id = required(argv, "--id");
  const registry = registryFrom(argv);
  const loaded = loadThreads(root, registry.ids()).find((item) => item.thread.id === id);
  if (loaded === undefined) fail(`тред '${id}' не найден в '${root}'`, 2);

  const { thread } = loaded as NonNullable<typeof loaded>;
  const rendered = renderThread(thread.meta, thread.messages);

  if (argv.includes("--write")) {
    writeOut(join(root, id, "_thread.md"), rendered);
    out(`agent-protocol: ${id}/_thread.md собран из ${thread.messages.length} сообщений`);
    return;
  }
  out(rendered);
};

const checkAll = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv);
  const threads = loadThreads(root, registry.ids());

  const issues = threads.flatMap((loaded) =>
    loaded.input === undefined ? [] : checkThread(loaded.input, registry),
  );
  const legacy = threads.filter((loaded) => loaded.legacy).map((loaded) => loaded.thread.id);

  // Неизменность сообщений проверяется ОТНОСИТЕЛЬНО ТОЧКИ В ИСТОРИИ: на диске
  // лежит только «сейчас», и вопрос «правили ли задним числом» без ref не имеет
  // смысла. Нет `--since` — говорим об этом вслух: молчание читалось бы как
  // «проверено и цело», то есть проверка превратилась бы в свою
  // противоположность ровно там, где она и нужна.
  const since = flag(argv, "--since");
  if (since === undefined) {
    out("agent-protocol: неизменность сообщений НЕ проверялась — нужен --since <ref>");
  } else {
    const previous = messagesAtRef(root, since);
    const current = new Map<string, string>();
    for (const path of previous.keys()) {
      try {
        current.set(path, readFileSync(join(root, path), "utf8"));
      } catch {
        // Файла нет — это и есть удаление; checkImmutable скажет об этом сам.
      }
    }
    issues.push(...checkImmutable(previous, current));
    out(`agent-protocol: сверено с '${since}' — сообщений в истории: ${previous.size}`);
  }

  if (legacy.length > 0) {
    out(`agent-protocol: ещё не мигрированы (читаются как есть): ${legacy.join(", ")}`);
  }
  if (issues.length === 0) {
    out(`agent-protocol: ok — ${threads.length - legacy.length} тредов прошли проверку формата`);
    return;
  }
  err("agent-protocol: формат нарушен:");
  for (const issue of issues) {
    err(`- ${issue.thread}${issue.file === undefined ? "" : `/${issue.file}`}: ${issue.message}`);
  }
  process.exit(1);
};

const migrate = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv);
  const only = flag(argv, "--id");
  const doWrite = argv.includes("--write");

  const threads = loadThreads(root, registry.ids()).filter(
    (loaded) => loaded.legacy && (only === undefined || loaded.thread.id === only),
  );
  if (threads.length === 0) {
    out("agent-protocol: мигрировать нечего — все треды уже в файлах сообщений");
    return;
  }

  let failed = 0;
  for (const loaded of threads) {
    const id = loaded.thread.id;
    const original = readFile(join(root, id, "_thread.md"), `тред ${id}`);
    const migration = migrateLegacyThread(id, original, registry.ids());
    const mismatch = verifyMigration(migration, original);

    if (mismatch !== undefined) {
      err(`- ${id}: ГАРД НЕ ПРОЙДЕН, миграция не принята — ${mismatch}`);
      failed++;
      continue;
    }
    // Коллизия имён — тоже отказ, а не строчка в stderr: запись затёрла бы одно
    // сообщение другим, и потеря всплыла бы только при следующей регенерации.
    if (migration.collisions.length > 0) {
      for (const collision of migration.collisions) {
        err(`- ${id}: КОЛЛИЗИЯ ИМЁН, миграция не принята — ${collision}`);
      }
      failed++;
      continue;
    }

    const messages = migration.files.filter((file) => file.path.startsWith("messages/")).length;
    if (doWrite) {
      for (const file of migration.files) writeOut(join(root, id, file.path), file.content);
      out(`- ${id}: перенесён (${messages} сообщений), склейка воспроизводит исходник байт-в-байт`);
    } else {
      out(`- ${id}: готов к переносу (${messages} сообщений), гард пройден`);
    }
  }

  if (failed > 0) fail(`миграция не принята для ${failed} тредов`, 1);
  if (!doWrite) out("agent-protocol: показан план; запись — с --write");
};

const mail = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const role = required(argv, "--role");
  const registry = registryFrom(argv);
  if (!registry.isKnown(role)) fail(`роль '${role}' не значится в конфиге`, 2);

  // Почта считается из ТРЕДОВ, а не из производного INDEX: иначе падение
  // генератора реестра ослепило бы вахту и сторожа (боль 5, тред 008).
  const threads = loadThreads(root, registry.ids()).map((loaded) => loaded.thread);
  for (const id of threadsWaitingOn(threads, role)) out(id);
};

const main = (argv: readonly string[]): void => {
  const [command, subcommand] = argv;
  if (command === "roles" && subcommand === "check") {
    rolesCheck(argv.slice(2));
  } else if (command === "index" && subcommand === "build") {
    indexBuild(argv.slice(2));
  } else if (command === "thread" && subcommand === "build") {
    threadBuild(argv.slice(2));
  } else if (command === "check") {
    checkAll(argv.slice(1));
  } else if (command === "migrate") {
    migrate(argv.slice(1));
  } else if (command === "mail") {
    mail(argv.slice(1));
  } else {
    fail(USAGE, 2);
  }
};

main(process.argv.slice(2));
