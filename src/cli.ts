#!/usr/bin/env node
/**
 * Точка входа для операторов контура. На P1 умеет одно — сверить конфиг ролей
 * с документом:
 *
 *   agent-protocol roles check --config <roles.json> --doc <ROLES.md>
 *
 * Пути ОБЯЗАТЕЛЬНЫ и умолчаний не имеют: умолчание вроде
 * `agent-comms/ROLES.md` было бы знанием о конкретном проекте внутри
 * нейтрального пакета (дисциплина выносимости). Расположение файлов —
 * дело проекта, и оно документируется у проекта.
 *
 * КАЖДЫЙ ОТКАЗ ГРОМКИЙ. Урок спайка P0: команда, молча зависящая от
 * окружения, даёт результат, неотличимый от дефекта проверяемого — три из
 * трёх сбоев спайка были такими (пропавший файл, проигнорированное имя,
 * PATH). Поэтому нечитаемый файл, кривой JSON и невалидный конфиг — это
 * ненулевой код и текст в stderr, а не пустой вывод.
 */
import { readFileSync } from "node:fs";

import { loadRoleRegistry, RoleConfigError } from "./roles/registry.js";
import { diffRolesDoc } from "./roles/roles-doc.js";

const USAGE = "usage: agent-protocol roles check --config <roles.json> --doc <ROLES.md>";

const fail = (message: string, code: number): never => {
  process.stderr.write(`agent-protocol: ${message}\n`);
  process.exit(code);
};

const readFlag = (argv: readonly string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  return argv[at + 1];
};

const readFile = (path: string, what: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return fail(`не смог прочитать ${what} '${path}': ${(error as Error).message}`, 2);
  }
};

const rolesCheck = (argv: readonly string[]): void => {
  const configPath = readFlag(argv, "--config");
  const docPath = readFlag(argv, "--doc");
  if (!configPath || !docPath) fail(USAGE, 2);

  const rawConfig = readFile(configPath as string, "конфиг ролей");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    fail(`конфиг '${configPath}' — не JSON: ${(error as Error).message}`, 2);
  }

  let registry: ReturnType<typeof loadRoleRegistry>;
  try {
    registry = loadRoleRegistry(parsed);
  } catch (error) {
    if (error instanceof RoleConfigError) fail(error.message, 2);
    throw error;
  }

  const drift = diffRolesDoc(registry, readFile(docPath as string, "документ ролей"));
  if (drift.length === 0) {
    process.stdout.write(
      `agent-protocol: ok — конфиг и документ описывают одни и те же роли (${registry.ids().length})\n`,
    );
    return;
  }

  process.stderr.write("agent-protocol: конфиг ролей разошёлся с документом:\n");
  for (const item of drift) process.stderr.write(`- ${item.message}\n`);
  process.exit(1);
};

const main = (argv: readonly string[]): void => {
  const [command, subcommand] = argv;
  if (command === "roles" && subcommand === "check") {
    rolesCheck(argv.slice(2));
    return;
  }
  fail(USAGE, 2);
};

main(process.argv.slice(2));
