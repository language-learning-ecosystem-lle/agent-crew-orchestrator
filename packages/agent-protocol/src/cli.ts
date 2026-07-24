#!/usr/bin/env node
/**
 * Точка входа для операторов контура. Полный синтаксис — в константе `USAGE`
 * ниже, и это ЕДИНСТВЕННЫЙ его источник: шапка и справка уже разошлись однажды
 * (здесь стоял синтаксис эпохи P1 — `roles check --config/--doc`, которого
 * давно нет), так что список команд в двух местах не держим.
 *
 * `--ref` ОБЯЗАТЕЛЕН везде и умолчания не имеет: он определяет, КАКУЮ версию
 * конфига читаем, и молчаливый выбор версии был бы тихой ошибкой. `--repo`
 * умолчание имеет (репозиторий текущего каталога или того, где лежит почта):
 * каталог однозначен, а требование указывать его руками ломало каждый
 * документированный пример.
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
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { loadProtocolConfig } from "./config/load.js";
import { loadThreads } from "./fs/comms.js";
import { fileExistsAtRef, messagesAtRef } from "./fs/git.js";
import {
  eventTimestamp,
  type OrchestratorEvent,
  orchestratorEventSchema,
  parseJournal,
  type ReleaseReason,
  renderEventLine,
} from "./orchestrator/journal.js";
import {
  buildLaunchPrompt,
  MAX_CONSECUTIVE_RUNS,
  planLaunch,
  roleLaunchability,
} from "./orchestrator/launch.js";
import { foldLeases } from "./orchestrator/lease.js";
import { renderLog } from "./orchestrator/log.js";
import { type Lifecycle, observeStep, stepEvent } from "./orchestrator/observe.js";
import { describeReboot, renderSystemdUnit } from "./orchestrator/reboot.js";
import { renderStatus } from "./orchestrator/status.js";
import { planTick } from "./orchestrator/tick.js";
import { RoleConfigError, type RoleRegistry } from "./roles/registry.js";
import type { Role } from "./roles/schema.js";
import { checkImmutable, checkThread } from "./thread/check.js";
import { renderIndex, threadsWaitingOn } from "./thread/index-doc.js";
import type { Expects } from "./thread/message.js";
import { EXPECTS, parseMessageFile } from "./thread/message.js";
import { migrateLegacyThread, verifyMigration } from "./thread/migrate.js";
import { renderThread } from "./thread/thread.js";
import {
  messageTimestamp,
  nextMessageTimestamp,
  planNewMessage,
  planNewThread,
  WriteRefusedError,
} from "./thread/write.js";

const USAGE = `usage (--ref обязателен всегда; --repo по умолчанию — репозиторий текущего каталога):
  agent-protocol config check --ref <ref> [--repo <path>] [--config-path <p>] [--no-fetch]
  agent-protocol roles list   --ref <ref> [--repo <path>]
  agent-protocol role exists  --ref <ref> --role <id> [--repo <path>]
  agent-protocol index build  --root <mail> --ref <ref> [--write]
  agent-protocol thread build --root <mail> --ref <ref> --id <NNN-slug> [--write]
  agent-protocol check        --root <mail> --ref <ref> [--since <ref>]
  agent-protocol migrate      --root <mail> --ref <ref> [--id <NNN-slug>] [--write]
  agent-protocol derive       --root <mail> --ref <ref> [--write]
  agent-protocol mail         --root <mail> --ref <ref> --role <id>
  agent-protocol new-message  --root <mail> --ref <ref> --thread <id> --from <role> --expects <e> [--waiting-on <r,r>] --body-file <p> [--write]
  agent-protocol new-thread   --root <mail> --ref <ref> --id <NNN-slug> --title <t> --participants <r,r> --from <role> --expects <e> [--waiting-on <r,r>] --body-file <p> [--write]
  agent-protocol orchestrator status --journal <path> [--now <iso>] [--enable-flag <path>] [--mode-file <path>]
  agent-protocol orchestrator record --journal <path> --kind <k> --role <id> --thread <slug> [--deadline <iso>] [--reason <r>] [--mode <m>] [--now <iso>] [--write]
  agent-protocol orchestrator run    --journal <path> --root <mail> --ref <ref> [--repo <p>] --role <id> --thread <slug> [--wall-clock <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--exec <bin>] [--force-flag <path>] [--now <iso>] [--write]
  agent-protocol orchestrator daemon --journal <path> --root <mail> --ref <ref> [--repo <p>] --enable-flag <path> --stop-flag <path> --force-flag <path> [--tick <sec>] [--wall-clock <sec>] [--poll <sec>] [--max-turns <n>] [--max-runs <n>] [--exec <bin>] [--once]
  agent-protocol orchestrator log    --journal <path>
  agent-protocol orchestrator stop   --mode graceful --stop-flag <path> [--write]
  agent-protocol orchestrator stop   --mode force --force-flag <path> --by <who> --reason <why> --root <mail> --ref <ref> [--repo <p>] --thread <slug> [--write]
  agent-protocol orchestrator systemd-unit --exec-start <cmd> [--working-dir <dir>] [--description <d>]`;

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

/**
 * Конфиг читается ТОЛЬКО через пакет и ТОЛЬКО по явному ref.
 *
 * `--repo` по умолчанию — репозиторий, которому принадлежит `--root`: почта и
 * код у нас в одном репозитории, просто в разных ветках, и заставлять каждый
 * вызов повторять путь значит плодить места, где он разъедется. Отдельный
 * `--repo` нужен раннеру, где чекаут почты и чекаут кода — разные каталоги.
 */
const configFrom = (
  argv: readonly string[],
  root?: string,
): ReturnType<typeof loadProtocolConfig> => {
  const ref = required(argv, "--ref");
  // Умолчания нет только у `ref` — именно он определяет, ЧТО мы читаем, и
  // молчаливый выбор версии и был бы дефектом. Каталог же однозначен: репозиторий
  // того места, откуда команду позвали (или того, где лежит почта). Требовать его
  // явно значило сделать неработающим каждый пример в документации — что и
  // случилось (находка ревьюера по PR #21).
  const repo = flag(argv, "--repo") ?? repoOf(root ?? process.cwd());
  const noFetch = argv.includes("--no-fetch");

  if (noFetch && ref.startsWith("origin/")) {
    // Молчаливо-старый конфиг неотличим от актуального — тот же класс, что
    // молча-пустой ответ git. Отказ от обновления допустим, но не молча.
    err(
      `agent-protocol: ВНИМАНИЕ — '${ref}' не обновлялся (--no-fetch), конфиг может быть устаревшим`,
    );
  }

  try {
    return loadProtocolConfig({
      repo,
      ref,
      fetch: !noFetch,
      ...(flag(argv, "--config-path") === undefined
        ? {}
        : { path: flag(argv, "--config-path") as string }),
    });
  } catch (error) {
    if (error instanceof RoleConfigError) return fail(error.message, 2);
    return fail(`конфиг протокола на '${ref}' не прочитан: ${(error as Error).message}`, 2);
  }
};

const registryFrom = (argv: readonly string[], root?: string): RoleRegistry =>
  configFrom(argv, root).registry;

const repoOf = (at: string): string => {
  try {
    return execFileSync("git", ["-C", at, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return fail(`'${at}' не в git-репозитории: ${(error as Error).message}`, 2);
  }
};

const writeOut = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

const configCheck = (argv: readonly string[]): void => {
  const loaded = configFrom(argv, undefined);
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());

  // Объявленные инструкции проверяются НА ТОМ ЖЕ ref, что и конфиг: проверять
  // существование файла на диске значило бы смотреть в другую версию дерева.
  const missing: string[] = [];
  for (const role of loaded.config.roles) {
    for (const entry of role.instructions ?? []) {
      if (!fileExistsAtRef(repo, loaded.ref, entry.path)) {
        missing.push(
          `роль '${role.id}': инструкции '${entry.path}' объявлены, но на ${loaded.ref} их нет`,
        );
      }
    }
  }

  if (missing.length === 0) {
    out(
      `agent-protocol: ok — конфиг '${loaded.path}' на ${loaded.ref}: ролей ${loaded.registry.ids().length}, почта в ветке '${loaded.config.mail.branch}' (${loaded.config.mail.dir})`,
    );
    return;
  }
  err("agent-protocol: конфиг ссылается на отсутствующие файлы:");
  for (const item of missing) err(`- ${item}`);
  process.exit(1);
};

const rolesList = (argv: readonly string[]): void => {
  for (const id of registryFrom(argv, undefined).ids()) out(id);
};

const roleExists = (argv: readonly string[]): void => {
  const role = required(argv, "--role");
  if (registryFrom(argv, undefined).isKnown(role)) return;
  err(`agent-protocol: роль '${role}' не значится в конфиге протокола`);
  process.exit(1);
};

const indexBuild = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
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
  const registry = registryFrom(argv, repoOf(root));
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
  const registry = registryFrom(argv, repoOf(root));
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
  const registry = registryFrom(argv, repoOf(root));
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
    // Коллизия имён — отказ (sanity-guard: с именем из seq она структурно
    // невозможна, но если генерация имён однажды сломается, потеря сообщения
    // не должна пройти молча — см. Migration.collisions).
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

/**
 * Пересобрать ВСЕ производные разом: `_thread.md` каждого мигрированного треда
 * (у кого есть `messages/`) + `INDEX.md`. Это то, что зовёт action на push в
 * ветку почты — один вызов вместо цикла в YAML.
 *
 * Без `--write` — сухой прогон: показывает, что РАЗОШЛОСЬ, и выходит кодом 1,
 * если расхождение есть. Молчаливо разошедшиеся производные — тот же класс, что
 * потерянный дубль вердикта: если сборка не совпала с диском, это обязано быть
 * видно (требование curated из 014), а не тихо «почти то же».
 */
const derive = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const registry = registryFrom(argv, repoOf(root));
  const doWrite = argv.includes("--write");
  const threads = loadThreads(root, registry.ids());

  const targets: { path: string; rendered: string }[] = [];
  for (const loaded of threads) {
    // `_thread.md` пересобирается только у мигрированных: у legacy он ИСТОЧНИК,
    // трогать его нельзя — перезапись сгенерированным сломала бы ещё не
    // перенесённый тред.
    if (loaded.legacy) continue;
    targets.push({
      path: join(root, loaded.thread.id, "_thread.md"),
      rendered: renderThread(loaded.thread.meta, loaded.thread.messages),
    });
  }
  targets.push({
    path: join(root, "INDEX.md"),
    rendered: renderIndex(threads.map((l) => l.thread)),
  });

  const drifted: string[] = [];
  for (const target of targets) {
    let current = "";
    try {
      current = readFileSync(target.path, "utf8");
    } catch {
      current = "";
    }
    if (current !== target.rendered) drifted.push(target.path);
  }

  if (doWrite) {
    for (const target of drifted) {
      const rendered = targets.find((t) => t.path === target)?.rendered ?? "";
      writeOut(target, rendered);
    }
    out(
      drifted.length === 0
        ? "agent-protocol: производные уже совпадают — писать нечего"
        : `agent-protocol: пересобрано производных: ${drifted.length}`,
    );
    return;
  }

  if (drifted.length === 0) {
    out(`agent-protocol: ok — производные совпадают (${targets.length} файлов проверено)`);
    return;
  }
  err("agent-protocol: производные разошлись с источником (--write пересоберёт):");
  for (const path of drifted) err(`- ${path}`);
  process.exit(1);
};

const parseExpects = (raw: string): Expects => {
  if (!(EXPECTS as readonly string[]).includes(raw)) {
    fail(`--expects '${raw}' — допустимо ${EXPECTS.join(" | ")}`, 2);
  }
  return raw as Expects;
};

const parseWaitingOn = (raw: string, registry: RoleRegistry): string[] => {
  const roles =
    raw === "—"
      ? []
      : raw
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r !== "");
  for (const role of roles) {
    // Неизвестная роль КРАСИТ, а не отбрасывается молча — иначе потеря роли из
    // объявления (боль 2) вернулась бы через инструмент записи.
    if (!registry.isKnown(role)) fail(`в --waiting-on роль '${role}', которой нет в конфиге`, 2);
  }
  return roles;
};

/**
 * Создать файл-сообщение в СУЩЕСТВУЮЩЕМ треде. Отказывается, если тред в
 * legacy-форме (нет `messages/`): файловая запись обрезала бы его историю.
 */
const newMessage = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const threadId = required(argv, "--thread");
  const from = required(argv, "--from");
  const registry = registryFrom(argv, repoOf(root));
  if (!registry.isKnown(from)) fail(`роль '${from}' не значится в конфиге`, 2);

  const threadDir = join(root, threadId);
  if (!existsSync(threadDir)) fail(`тред '${threadId}' не найден в '${root}'`, 2);
  const messagesDir = join(threadDir, "messages");
  const threadHasMessages = existsSync(messagesDir);

  // Метка монотонна по ленте: собираем метки уже лежащих НОВЫХ сообщений (с
  // временем — мигрированные, датированные без времени, исключаем) и клампим
  // новую строго после последней. Без этого перекос часов писателей ставит
  // ответ раньше вопроса (реальный случай в 012).
  const existingTs = threadHasMessages
    ? readdirSync(messagesDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => parseMessageFile(readFileSync(join(messagesDir, name), "utf8")).fields.date)
        .filter((date) => date.includes("T"))
    : [];

  const text = readFile(required(argv, "--body-file"), "тело сообщения");
  const waitingRaw = flag(argv, "--waiting-on");
  let planned: ReturnType<typeof planNewMessage>;
  try {
    planned = planNewMessage({
      from,
      date: nextMessageTimestamp(new Date(), existingTs),
      expects: parseExpects(required(argv, "--expects")),
      ...(waitingRaw === undefined ? {} : { waitingOn: parseWaitingOn(waitingRaw, registry) }),
      text,
      threadHasMessages,
    });
  } catch (error) {
    if (error instanceof WriteRefusedError) {
      fail(error.message, 2);
    }
    throw error;
  }

  const path = join(threadDir, planned.path);
  if (existsSync(path))
    fail(`файл '${planned.path}' уже существует — две записи в одну секунду?`, 2);

  if (argv.includes("--write")) {
    writeOut(path, planned.content);
    out(`agent-protocol: создано ${threadId}/${planned.path}`);
    return;
  }
  out(`agent-protocol: создаст ${threadId}/${planned.path} (--write запишет):`);
  out(planned.content);
};

/** Создать НОВЫЙ тред сразу в файловой форме (`_meta.md` + первое сообщение). */
const newThread = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const id = required(argv, "--id");
  const registry = registryFrom(argv, repoOf(root));

  const from = required(argv, "--from");
  if (!registry.isKnown(from)) fail(`роль '${from}' не значится в конфиге`, 2);
  const participants = required(argv, "--participants")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  for (const p of participants) {
    if (!registry.isKnown(p)) fail(`участник '${p}' не значится в конфиге`, 2);
  }

  const threadDir = join(root, id);
  if (existsSync(threadDir)) fail(`тред '${id}' уже существует`, 2);

  const text = readFile(required(argv, "--body-file"), "тело первого сообщения");
  const files = planNewThread({
    title: required(argv, "--title"),
    participants,
    from,
    date: messageTimestamp(new Date()),
    expects: parseExpects(required(argv, "--expects")),
    ...(flag(argv, "--waiting-on") === undefined
      ? {}
      : { waitingOn: parseWaitingOn(flag(argv, "--waiting-on") as string, registry) }),
    text,
  });

  if (argv.includes("--write")) {
    for (const file of files) writeOut(join(threadDir, file.path), file.content);
    out(`agent-protocol: создан тред ${id} (${files.length} файлов)`);
    return;
  }
  out(`agent-protocol: создаст тред ${id} (--write запишет):`);
  for (const file of files) out(`- ${id}/${file.path}`);
};

const mail = (argv: readonly string[]): void => {
  const root = required(argv, "--root");
  const role = required(argv, "--role");
  const registry = registryFrom(argv, repoOf(root));
  if (!registry.isKnown(role)) fail(`роль '${role}' не значится в конфиге`, 2);

  // Почта считается из ТРЕДОВ, а не из производного INDEX: иначе падение
  // генератора реестра ослепило бы вахту и сторожа (боль 5, тред 008).
  const threads = loadThreads(root, registry.ids()).map((loaded) => loaded.thread);
  for (const id of threadsWaitingOn(threads, role)) out(id);
};

/**
 * Момент, относительно которого считается `overdue` в `status`, и метка события
 * в `record`. По умолчанию — сейчас; `--now <iso>` фиксирует его для проверок
 * (тот же приём инъекции времени, что у ядра записи).
 */
const orchestratorNow = (argv: readonly string[]): Date => {
  const raw = flag(argv, "--now");
  if (raw === undefined) return new Date();
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return fail(`--now '${raw}' — не разбирается как дата`, 2);
  return at;
};

/**
 * Витрина состояния оркестратора — свёртка ЛОКАЛЬНОГО журнала. Отсутствующий
 * журнал — это пустое состояние (сессий ещё не было), а не ошибка: файл
 * появляется с первым событием. Нечитаемый по ДРУГОЙ причине — громкий отказ
 * внутри `readFile`.
 *
 * S4: опционально отражает РЕЖИМ РЕБУТА и enable-состояние (`--mode-file`,
 * `--enable-flag`). Так «как демон поднят и что будет после ребута» видно
 * командой, а не живёт в чьей-то памяти (требование curator). enable-состояние —
 * наличие файла-флага; показ его здесь и подтверждает персистентность (файл на
 * диске переживает ребут).
 */
const orchestratorStatus = (argv: readonly string[]): void => {
  const path = required(argv, "--journal");
  const events = existsSync(path) ? parseJournal(readFile(path, "журнал оркестратора")) : [];
  out(renderStatus(foldLeases(events, orchestratorNow(argv))));

  const modeFile = flag(argv, "--mode-file");
  const enableFlag = flag(argv, "--enable-flag");
  if (modeFile === undefined && enableFlag === undefined) return;

  const launchesEnabled = enableFlag !== undefined && existsSync(enableFlag);
  if (modeFile === undefined) {
    out(`запуски: ${launchesEnabled ? "включены" : "выключены"}`);
    return;
  }
  const mode = readFile(modeFile, "режим ребута").trim();
  if (mode !== "systemd" && mode !== "manual") {
    fail(`режим ребута '${mode}' в '${modeFile}' — ожидается systemd | manual`, 2);
    return;
  }
  out(describeReboot(mode, launchesEnabled));
};

/**
 * Печатает systemd unit-файл для демона (S4). Пакет НЕ прописывает себя в
 * систему: `systemctl enable` выполняет человек. Флаги (`--enable-flag` и др.)
 * в `--exec-start` держите на ПОСТОЯННОМ хранилище — иначе enable-состояние не
 * переживёт ребут.
 */
const orchestratorSystemdUnit = (argv: readonly string[]): void => {
  const execStart = required(argv, "--exec-start");
  const workingDir = flag(argv, "--working-dir") ?? process.cwd();
  const description = flag(argv, "--description");
  out(
    renderSystemdUnit({
      execStart,
      workingDir,
      ...(description === undefined ? {} : { description }),
    }),
  );
  err(
    "agent-protocol: `systemctl enable` — действие человека; флаги держите на постоянном хранилище (не tmpfs)",
  );
};

/**
 * Дописать ОДНО событие в журнал. Это write-примитив, которым с S1 пользуется
 * демон; в S0 он же делает шаг воспроизводимым руками. Форма события проверяется
 * схемой (обязательность полей по виду — `lease-acquired` без `--deadline`,
 * `lease-released` без `--reason` не пройдут), а не вручную. Роль против конфига
 * здесь НЕ сверяется намеренно: журнал — собственный локальный лог оркестратора,
 * авторитет «реальна ли роль» — тот конфиг, по которому демон и решил запуск;
 * повторная сверка связала бы локальный append с git-fetch без новой гарантии, а
 * опечатка не теряется молча — `status` покажет её строкой.
 */
const orchestratorRecord = (argv: readonly string[]): void => {
  const path = required(argv, "--journal");
  const raw: Record<string, unknown> = {
    kind: required(argv, "--kind"),
    ts: messageTimestamp(orchestratorNow(argv)),
    role: required(argv, "--role"),
    thread: required(argv, "--thread"),
  };
  for (const [option, field] of [
    ["--deadline", "deadline"],
    ["--reason", "reason"],
    ["--mode", "mode"],
  ] as const) {
    const value = flag(argv, option);
    if (value !== undefined) raw[field] = value;
  }

  const parsed = orchestratorEventSchema.safeParse(raw);
  if (!parsed.success) {
    // fail завершает процесс; return — чтобы CFA сузила parsed к успеху ниже
    // (значение из void-функции не возвращаем — на это ругался бы линтер).
    fail(`событие не прошло валидацию: ${parsed.error.issues.map((i) => i.message).join("; ")}`, 2);
    return;
  }
  const event = parsed.data;
  const line = renderEventLine(event);

  if (argv.includes("--write")) {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, "utf8");
    out(`agent-protocol: записано событие ${event.kind} (${event.role} · ${event.thread})`);
    return;
  }
  out(`agent-protocol: допишет в '${path}' (--write запишет):`);
  out(line);
};

const positiveInt = (argv: readonly string[], name: string, fallback: number): number => {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`${name} '${raw}' — ожидается положительное целое`, 2);
  }
  return value;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const appendEvent = (journalPath: string, event: OrchestratorEvent): void => {
  mkdirSync(dirname(journalPath), { recursive: true });
  appendFileSync(journalPath, `${renderEventLine(event)}\n`, "utf8");
};

/** Промпт для роли из её `instructions` (тексты читаются с рабочего дерева). */
const buildPromptForRole = (role: Role, thread: string, repo: string): string =>
  buildLaunchPrompt({
    role: role.id,
    thread,
    instructions: (role.instructions ?? []).map((entry) => ({
      path: entry.path,
      text: readFile(join(repo, entry.path), `инструкции роли ${role.id}`),
    })),
  });

/**
 * Дописать файл-сообщение в тред (тот же путь, что `new-message`, но как
 * подпрограмма — нужен force-стопу для следа В ТРЕДЕ). Пишет файл; коммит/пуш —
 * за вызывающим, как и у `new-message`.
 */
const postThreadMessage = (
  root: string,
  threadId: string,
  registry: RoleRegistry,
  input: { from: string; expects: Expects; waitingOn?: readonly string[]; text: string },
): void => {
  if (!registry.isKnown(input.from)) fail(`роль '${input.from}' не значится в конфиге`, 2);
  const threadDir = join(root, threadId);
  if (!existsSync(threadDir)) fail(`тред '${threadId}' не найден в '${root}'`, 2);
  const messagesDir = join(threadDir, "messages");
  const threadHasMessages = existsSync(messagesDir);
  const existingTs = threadHasMessages
    ? readdirSync(messagesDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => parseMessageFile(readFileSync(join(messagesDir, name), "utf8")).fields.date)
        .filter((date) => date.includes("T"))
    : [];
  let planned: ReturnType<typeof planNewMessage>;
  try {
    planned = planNewMessage({
      from: input.from,
      date: nextMessageTimestamp(new Date(), existingTs),
      expects: input.expects,
      ...(input.waitingOn === undefined ? {} : { waitingOn: input.waitingOn }),
      text: input.text,
      threadHasMessages,
    });
  } catch (error) {
    if (error instanceof WriteRefusedError) {
      fail(error.message, 2);
      return;
    }
    throw error;
  }
  const path = join(threadDir, planned.path);
  if (existsSync(path))
    fail(`файл '${planned.path}' уже существует — две записи в одну секунду?`, 2);
  writeOut(path, planned.content);
};

type RunParams = {
  readonly journalPath: string;
  readonly mailRoot: string;
  readonly roleId: string;
  readonly thread: string;
  readonly prompt: string;
  readonly exec: string;
  readonly maxTurns: string;
  readonly wallClockMs: number;
  readonly pollMs: number;
  readonly ids: readonly string[];
  readonly now: Date;
  readonly maxConsecutive: number;
  /** Файл-флаг force-стопа (S4). Есть — гасим сессию на безопасной точке. */
  readonly forceFlag?: string;
};

/** Кто/почему из файла force-флага (JSON, писан `stop --mode force`). Лениво. */
const readForceFlag = (path: string): { by?: string; note?: string } => {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { by?: unknown; note?: unknown };
    return {
      ...(typeof raw.by === "string" ? { by: raw.by } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    };
  } catch {
    return {}; // пустой/битый флаг — стоп всё равно исполняем, просто без кто/почему
  }
};

/**
 * ОДИН прогон: запуск роли `claude -p` по треду + наблюдение до терминала
 * (S1+S2). Пишет `lease-acquired`+`launch` ДО спавна, следит за переходом хода
 * (из источника-тредов) и процессом, снимает аренду со следом. Используется и
 * ручным `run`, и демоном `daemon`. Возвращает исход (или `skip`, если
 * `planLaunch` отказал — потолок/активна/exhausted).
 */
const runOne = async (p: RunParams): Promise<"skip" | ReleaseReason> => {
  const events = existsSync(p.journalPath)
    ? parseJournal(readFile(p.journalPath, "журнал оркестратора"))
    : [];
  const plan = planLaunch({
    events,
    role: p.roleId,
    thread: p.thread,
    now: p.now,
    wallClockMs: p.wallClockMs,
    maxConsecutive: p.maxConsecutive,
  });
  if (!plan.ok) {
    err(`agent-protocol: запуск ${p.roleId}/${p.thread} отклонён (${plan.reason})`);
    return "skip";
  }

  // ЗАПИСЬ ДО СПАВНА (требование 2 curator): умри процесс на старте — снаружи
  // «попытка была и оборвалась», а не «ничего не происходило».
  for (const event of plan.events) appendEvent(p.journalPath, event);

  // Спавн в СВОЕЙ процесс-группе (`detached`): гасить придётся всю группу, а не
  // только прямого потомка — SIGTERM шеллу/лончеру не доходит до его детей
  // (стаб → sleep, `claude` → его подпроцессы), и они осиротели бы.
  const child = spawn(p.exec, ["-p", p.prompt, "--max-turns", p.maxTurns], {
    stdio: "inherit",
    detached: true,
  });
  let exited = false;
  let spawnError: Error | undefined;
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", (error) => {
    exited = true;
    spawnError = error;
  });

  const deadlineMs = new Date(plan.deadline).getTime();
  let lifecycle: Lifecycle = "running";

  while (true) {
    await sleep(p.pollMs);

    // FORCE-СТОП (S4) — проверяется ПЕРВЫМ в тике и на БЕЗОПАСНОЙ ТОЧКЕ: между
    // поллингами, не посреди нашей записи (append атомарен). Гасим группу
    // SIGTERM (не KILL): даём `claude` дописать/закоммитить. След — событие
    // `stop` с `by`/`note` (кто/почему) + `ts` (когда): самодостаточно в журнале.
    if (p.forceFlag !== undefined && existsSync(p.forceFlag)) {
      if (!exited && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // группы уже нет — ок
        }
      }
      const { by, note } = readForceFlag(p.forceFlag);
      appendEvent(p.journalPath, {
        kind: "stop",
        ts: eventTimestamp(new Date()),
        role: p.roleId,
        thread: p.thread,
        mode: "forced",
        ...(by === undefined ? {} : { by }),
        ...(note === undefined ? {} : { note }),
      });
      return "forced";
    }

    // Переход хода — из ИСТОЧНИКА-тредов (тот же, что `mail`): тред взят под
    // аренду, ждал роль; перестал ждать её → ход передан. Не «код 0», не «почта
    // пуста».
    const handedOff = !threadsWaitingOn(
      loadThreads(p.mailRoot, p.ids).map((loaded) => loaded.thread),
      p.roleId,
    ).includes(p.thread);
    const step = observeStep(lifecycle, {
      handedOff,
      processExited: exited,
      overdue: Date.now() > deadlineMs,
    });
    if (step === null) continue;

    const base = { ts: eventTimestamp(new Date()), role: p.roleId, thread: p.thread };
    if (step.record === "handoff-detected") {
      appendEvent(p.journalPath, stepEvent(step, base));
      lifecycle = "draining";
      out(`agent-protocol: ход по ${p.thread} перешёл — ${p.roleId} в draining`);
      continue;
    }

    // Терминальный lease-released. Процесс ещё жив (застрял/доживает) — гасим ВСЮ
    // группу (`-pid`): wall-clock гигиена для timeout, уборка залипшего для
    // completed. Группа уже мёртвая → ESRCH, глотаем.
    if (!exited && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // группы уже нет — ок
      }
    }
    appendEvent(p.journalPath, stepEvent(step, base));
    if (spawnError !== undefined) {
      err(`agent-protocol: спавн '${p.exec}' дал ошибку: ${spawnError.message}`);
    }
    return step.reason;
  }
};

/**
 * Ручной запуск ОДНОЙ роли по ОДНОМУ треду (S1+S2). Резолвит роль → промпт,
 * проверяет запускаемость, дальше — `runOne`. `--exec` (по умолчанию `claude`)
 * инъектируется: приёмка целится в реальный бинарник, проверки — в стаб.
 */
const orchestratorRun = async (argv: readonly string[]): Promise<void> => {
  const journalPath = required(argv, "--journal");
  const roleId = required(argv, "--role");
  const thread = required(argv, "--thread");
  const mailRoot = required(argv, "--root");
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());

  const registry = registryFrom(argv, undefined);
  const role = registry.get(roleId);
  if (role === undefined) {
    fail(`роль '${roleId}' не значится в конфиге`, 2);
    return;
  }
  const can = roleLaunchability(role);
  if (!can.launchable) {
    fail(`роль '${roleId}' оркестратором не запускается: ${can.reason}`, 2);
    return;
  }
  const prompt = buildPromptForRole(role, thread, repo);

  const now = orchestratorNow(argv);
  const wallClockMs = positiveInt(argv, "--wall-clock", 900) * 1000;
  const maxConsecutive = positiveInt(argv, "--max-runs", MAX_CONSECUTIVE_RUNS);
  const pollMs = positiveInt(argv, "--poll", 10) * 1000;
  const exec = flag(argv, "--exec") ?? "claude";
  const maxTurns = String(positiveInt(argv, "--max-turns", 60));
  const forceFlag = flag(argv, "--force-flag"); // force-стоп и для ручного run

  if (!argv.includes("--write")) {
    const events = existsSync(journalPath)
      ? parseJournal(readFile(journalPath, "журнал оркестратора"))
      : [];
    const plan = planLaunch({ events, role: roleId, thread, now, wallClockMs, maxConsecutive });
    if (!plan.ok) {
      fail(`запуск отклонён (${plan.reason}) — потолок сработал, см. журнал`, 2);
      return;
    }
    out(
      `agent-protocol: запустит '${exec} -p' и будет наблюдать переход хода по ${thread} (роль ${roleId}, deadline ${plan.deadline}, poll ${pollMs / 1000}s); --write выполнит. Пред-события:`,
    );
    for (const event of plan.events) out(renderEventLine(event));
    return;
  }

  const reason = await runOne({
    journalPath,
    mailRoot,
    roleId,
    thread,
    prompt,
    exec,
    maxTurns,
    wallClockMs,
    pollMs,
    ids: registry.ids(),
    now,
    maxConsecutive,
    ...(forceFlag === undefined ? {} : { forceFlag }),
  });
  if (reason !== "skip") out(`agent-protocol: прогон ${roleId}/${thread} завершён: ${reason}`);
};

/**
 * Демон: запуск ролей ПО ПОЧТЕ, без человека в цикле (S3). Каждый тик читает
 * флаги-файлы (включение/стоп), почту (источник-треды) и журнал, зовёт
 * `planTick` и исполняет ОДНО решение: `halt` (стоп-флаг) — выход; `disabled`
 * (нет флага включения) — ждём; `refused` — пишем `launch-refused` (глобальный
 * потолок со следом); `launch` — поднимаем пару `runOne` и тикаем заново.
 *
 * ТРИ ГАРДА ПРОТИВ РАСХОДА БЕЗ ПРИСМОТРА (требования curator к S3):
 *  - стартовое состояние ВЫКЛЮЧЕНО: без `--enable-flag` на диске — ни одного
 *    запуска; включает john, создав файл. Первый автономный запуск не случаен.
 *  - аварийный тормоз: `--stop-flag` проверяется ПЕРЕД каждым тиком и
 *    перекрывает включение. Простейшая форма S4 уже здесь.
 *  - глобальный потолок — со следом в журнале.
 *
 * Роль ребута машины (демон поднимается сам или руками) — развилка john, вне
 * кода демона: он одинаков, отличается лишь то, как его запускают.
 */
const orchestratorDaemon = async (argv: readonly string[]): Promise<void> => {
  const journalPath = required(argv, "--journal");
  const mailRoot = required(argv, "--root");
  const repo = flag(argv, "--repo") ?? repoOf(process.cwd());
  const enableFlag = required(argv, "--enable-flag");
  const stopFlag = required(argv, "--stop-flag");
  const forceFlag = required(argv, "--force-flag");

  const registry = registryFrom(argv, undefined);
  const ids = registry.ids();
  const launchable = registry
    .active()
    .filter((role) => roleLaunchability(role).launchable)
    .map((role) => role.id);

  const tickMs = positiveInt(argv, "--tick", 30) * 1000;
  const wallClockMs = positiveInt(argv, "--wall-clock", 900) * 1000;
  const maxConsecutive = positiveInt(argv, "--max-runs", MAX_CONSECUTIVE_RUNS);
  const pollMs = positiveInt(argv, "--poll", 10) * 1000;
  const exec = flag(argv, "--exec") ?? "claude";
  const maxTurns = String(positiveInt(argv, "--max-turns", 60));
  const once = argv.includes("--once"); // один тик — для проверок

  out(
    `agent-protocol: демон поднят (ВЫКЛЮЧЕН, пока нет '${enableFlag}'); стоп '${stopFlag}', force '${forceFlag}'; роли ${launchable.join(", ") || "—"}`,
  );

  for (;;) {
    // Кандидаты — пары (роль, тред), где запускаемая роль ждёт по треду.
    const threads = loadThreads(mailRoot, ids).map((loaded) => loaded.thread);
    const candidates = launchable.flatMap((roleId) =>
      threadsWaitingOn(threads, roleId).map((thread) => ({ role: roleId, thread })),
    );
    const events = existsSync(journalPath)
      ? parseJournal(readFile(journalPath, "журнал оркестратора"))
      : [];
    const decision = planTick({
      enabled: existsSync(enableFlag),
      // Force-флаг тоже останавливает демон (S4): его текущую сессию гасит
      // наблюдатель, а нового брать нельзя — иначе следующий тик поднял бы роль
      // прямо под force.
      stopped: existsSync(stopFlag) || existsSync(forceFlag),
      events,
      candidates,
      now: new Date(),
      maxConsecutive,
    });

    if (decision.kind === "halt") {
      out(`agent-protocol: демон остановлен — ${existsSync(forceFlag) ? "force" : "стоп"}-флаг`);
      return;
    }
    if (decision.kind === "refused") {
      appendEvent(journalPath, {
        kind: "launch-refused",
        ts: eventTimestamp(new Date()),
        role: decision.role,
        thread: decision.thread,
        reason: decision.reason,
      });
      err(
        `agent-protocol: запуск ${decision.role}/${decision.thread} отклонён (${decision.reason})`,
      );
    } else if (decision.kind === "launch") {
      const role = registry.get(decision.role);
      if (role !== undefined) {
        const reason = await runOne({
          journalPath,
          mailRoot,
          roleId: decision.role,
          thread: decision.thread,
          prompt: buildPromptForRole(role, decision.thread, repo),
          exec,
          maxTurns,
          wallClockMs,
          pollMs,
          ids,
          now: new Date(),
          maxConsecutive,
          forceFlag,
        });
        out(`agent-protocol: демон — ${decision.role}/${decision.thread}: ${reason}`);
      }
    }
    // decision.kind === "disabled" | "idle" — ждём и тикаем заново.

    if (once) return;
    await sleep(tickMs);
  }
};

/** Вывод журнала наружу для john (S4): история событий по порядку, читаемо. */
const orchestratorLog = (argv: readonly string[]): void => {
  const path = required(argv, "--journal");
  const events = existsSync(path) ? parseJournal(readFile(path, "журнал оркестратора")) : [];
  out(renderLog(events));
};

/**
 * Принудительная остановка (S4). `graceful` — создаёт стоп-флаг: демон дочитывает
 * текущую сессию до естественного терминала и гаснет (через draining), нового не
 * берёт. `force` — создаёт force-флаг с `by`/`note` (его читает наблюдатель и
 * гасит сессию на безопасной точке, оставляя журнальный след) И постит СЛЕД В
 * ТРЕД (кто/почему), так что «кто/когда/почему» есть и в журнале, и в треде.
 */
const orchestratorStop = (argv: readonly string[]): void => {
  const mode = required(argv, "--mode");
  if (mode !== "graceful" && mode !== "force") {
    fail(`--mode '${mode}' — допустимо graceful | force`, 2);
    return;
  }
  const write = argv.includes("--write");

  if (mode === "graceful") {
    const stopFlag = required(argv, "--stop-flag");
    if (!write) {
      out(
        `agent-protocol: создаст стоп-флаг '${stopFlag}' (демон дочитает текущее и гаснет); --write выполнит`,
      );
      return;
    }
    mkdirSync(dirname(stopFlag), { recursive: true });
    writeFileSync(stopFlag, "", "utf8");
    out(`agent-protocol: graceful-стоп — стоп-флаг '${stopFlag}' создан`);
    return;
  }

  // force: флаг с кто/почему + объявление в тред.
  const forceFlag = required(argv, "--force-flag");
  const by = required(argv, "--by");
  const why = required(argv, "--reason");
  const root = required(argv, "--root");
  const threadId = required(argv, "--thread");
  const registry = registryFrom(argv, repoOf(root));
  const flagBody = JSON.stringify({ by, note: why });
  const text = `Сессия по треду ${threadId} принудительно остановлена (by ${by}): ${why}`;

  if (!write) {
    out(
      `agent-protocol: создаст force-флаг '${forceFlag}' и объявит в тред ${threadId}; --write выполнит`,
    );
    return;
  }
  mkdirSync(dirname(forceFlag), { recursive: true });
  writeFileSync(forceFlag, flagBody, "utf8");
  postThreadMessage(root, threadId, registry, {
    from: "github",
    expects: "none",
    text,
  });
  out(`agent-protocol: force-стоп — флаг '${forceFlag}' создан, след объявлен в тред ${threadId}`);
};

const main = async (argv: readonly string[]): Promise<void> => {
  const [command, subcommand] = argv;
  if (command === "config" && subcommand === "check") {
    configCheck(argv.slice(2));
  } else if (command === "roles" && subcommand === "list") {
    rolesList(argv.slice(2));
  } else if (command === "role" && subcommand === "exists") {
    roleExists(argv.slice(2));
  } else if (command === "index" && subcommand === "build") {
    indexBuild(argv.slice(2));
  } else if (command === "thread" && subcommand === "build") {
    threadBuild(argv.slice(2));
  } else if (command === "check") {
    checkAll(argv.slice(1));
  } else if (command === "migrate") {
    migrate(argv.slice(1));
  } else if (command === "derive") {
    derive(argv.slice(1));
  } else if (command === "new-message") {
    newMessage(argv.slice(1));
  } else if (command === "new-thread") {
    newThread(argv.slice(1));
  } else if (command === "mail") {
    mail(argv.slice(1));
  } else if (command === "orchestrator" && subcommand === "status") {
    orchestratorStatus(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "record") {
    orchestratorRecord(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "run") {
    await orchestratorRun(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "daemon") {
    await orchestratorDaemon(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "log") {
    orchestratorLog(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "stop") {
    orchestratorStop(argv.slice(2));
  } else if (command === "orchestrator" && subcommand === "systemd-unit") {
    orchestratorSystemdUnit(argv.slice(2));
  } else {
    fail(USAGE, 2);
  }
};

main(process.argv.slice(2)).catch((error) => {
  err(`agent-protocol: непойманная ошибка: ${(error as Error).message}`);
  process.exit(1);
});
