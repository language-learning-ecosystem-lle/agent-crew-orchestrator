/**
 * Пути оркестратора — ВЫВОДЯТСЯ, а не передаются (решение john, тред 012,
 * 22:45). Раньше журнал, три флага, каталог holdʼов и корень почты приходили
 * аргументами, то есть жили в переписке и в чьей-то памяти; вторая эксплуатация
 * начиналась с реконструкции команды по чату.
 *
 * Разделение ответственности здесь ровно такое же, как во всём пакете: проект
 * говорит ГДЕ (`orchestrator.state`, `orchestrator.mailCheckout` в конфиге),
 * пакет — ЧТО там лежит. Имена файлов внутри каталога состояния — конвенция
 * пакета, и наружу они не выносятся: это его собственные файлы.
 *
 * Функция чистая: строки на входе, строки на выходе. Никакой файловой системы —
 * создание каталогов принадлежит командам, которые ими владеют.
 */
import { join } from "node:path";

import type { Mail, Orchestrator } from "../config/config.js";

export type OrchestratorPaths = {
  /** Каталог оперативного состояния целиком — его создаёт команда, а не человек. */
  readonly state: string;
  /** Журнал событий (JSONL, локальный, не в git). */
  readonly journal: string;
  /** Флаг «запуски включены» — его создаёт `enable`. */
  readonly enableFlag: string;
  /** Флаг graceful-стопа. */
  readonly stopFlag: string;
  /** Флаг force-стопа (несёт `by`/`note`). */
  readonly forceFlag: string;
  /** Каталог holdʼов ручных сессий. */
  readonly holds: string;
  /** Каталог сохранённых выводов сессий — разбор молчания без свидетеля. */
  readonly sessions: string;
  /** Корень почты на диске: чекаут ветки почты + каталог почты в нём. */
  readonly mailRoot: string;
};

/** Имена внутри каталога состояния — конвенция пакета, не конфиг проекта. */
const JOURNAL = "journal.jsonl";
const ENABLE = "enabled";
const STOP = "stop";
const FORCE = "force";
const HOLDS = "holds";
const SESSIONS = "sessions";

export const orchestratorPaths = (input: {
  /** Корень репозитория: пути в конфиге относительны ему. */
  readonly repo: string;
  readonly orchestrator: Orchestrator;
  readonly mail: Mail;
}): OrchestratorPaths => {
  const state = join(input.repo, input.orchestrator.state);
  return {
    state,
    journal: join(state, JOURNAL),
    enableFlag: join(state, ENABLE),
    stopFlag: join(state, STOP),
    forceFlag: join(state, FORCE),
    holds: join(state, HOLDS),
    sessions: join(state, SESSIONS),
    mailRoot: join(input.repo, input.orchestrator.mailCheckout, input.mail.dir),
  };
};

/**
 * Человеку — куда пакет положил своё состояние. Печатается командами включения
 * и `status`: «где лежит флаг» обязано быть видно из вывода, а не из README.
 */
/**
 * Файл вывода одной сессии. Имя несёт связку и момент — по журналу видно, какой
 * прогон куда писал, и логи не перетирают друг друга при повторных попытках.
 */
export const sessionLogPath = (
  sessions: string,
  role: string,
  thread: string,
  stamp: string,
): string => join(sessions, `${stamp.replace(/[:]/g, "-")}-${role}-${thread}.log`);

export const renderPaths = (paths: OrchestratorPaths): string =>
  [
    `состояние: ${paths.state}`,
    `журнал:    ${paths.journal}`,
    `флаги:     ${paths.enableFlag} · ${paths.stopFlag} · ${paths.forceFlag}`,
    `holdʼы:    ${paths.holds}`,
    `логи сессий: ${paths.sessions}`,
    `почта:     ${paths.mailRoot}`,
  ].join("\n");
