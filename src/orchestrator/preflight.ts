/**
 * Preflight — проверки ПЕРЕД тем, как контур возьмёт аренду. Шаг S8 (тред 012).
 *
 * Правило, которое curator назвал после третьего случая одного класса за сутки:
 * **то, что человек обязан помнить перед прогоном, машина делает сама или громко
 * отказывается.** Пути жили в переписке (S6), полномочия — нигде (S7), среда и
 * свежесть почты — в подсказках в чате. Каждый раз цена одна: контур выглядит
 * работающим и работает не так.
 *
 * ТРИ ВЕЩИ, КОТОРЫЕ НЕЛЬЗЯ ОСТАВЛЯТЬ ПАМЯТИ ЧЕЛОВЕКА:
 *
 *  1. **Бинарь агента.** Его отсутствие выяснялось бы фактом спавна — при УЖЕ
 *     взятой аренде: в журнале появилась бы попытка, которой не было.
 *  2. **Свежесть чекаута почты.** Демон читает почту с диска. Устаревший чекаут
 *     значит «прочитал вчерашнюю почту и молча отработал по ней» — в автономном
 *     режиме это не сбой, а НЕПРАВИЛЬНАЯ РАБОТА, худший из исходов: результат
 *     есть, он неверен, и никто этого не видит.
 *  3. **Среда глазами ребёнка.** Печатаем то, что реально унаследует дочерний
 *     процесс, а не то, что «должно быть»: версия node у оболочки агента и у
 *     демона — разные вещи, и расхождение уже стоило проекту отдельного урока.
 *
 * ТУЛЧЕЙН-МЕНЕДЖМЕНТ ПАКЕТУ НЕ ОТДАЁТСЯ (`nvm use` и подобное) — это знание о
 * проекте, а его у пакета ноль. Проект объявляет преамбулу окружения в конфиге
 * (`orchestrator.env`), пакет её применяет и ПОКАЗЫВАЕТ, что получилось.
 *
 * Здесь — чистое ядро: факты на входе, вердикты на выходе. Зонды (git, `which`,
 * запуск `node --version`) живут в CLI, где им и место.
 */

export type CheckStatus = "ok" | "fail";

export type PreflightCheck = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

/** Наблюдаемое состояние чекаута почты — то, что CLI спрашивает у git. */
export type CheckoutFacts = {
  /** Ветка, на которой стоит чекаут. */
  readonly branch: string;
  /** Ветка почты из конфига. */
  readonly expectedBranch: string;
  /** Есть несохранённые изменения (в т.ч. незакоммиченные сообщения). */
  readonly dirty: boolean;
  /** Коммитов позади origin ПОСЛЕ попытки обновления. */
  readonly behind: number;
  /** Локальных коммитов, которых нет в origin. */
  readonly ahead: number;
};

/**
 * Вердикт по чекауту почты. Отказ, а не автопочинка, там, где починка означала
 * бы уничтожение чужой работы: грязное дерево — это, возможно, сообщение,
 * которое роль прямо сейчас пишет, и `reset --hard` стёр бы его молча.
 */
export const mailCheckoutVerdict = (facts: CheckoutFacts): PreflightCheck => {
  const name = "почта: свежесть чекаута";
  if (facts.branch !== facts.expectedBranch) {
    return {
      name,
      status: "fail",
      detail: `чекаут стоит на '${facts.branch}', а почта живёт в '${facts.expectedBranch}'`,
    };
  }
  if (facts.dirty) {
    return {
      name,
      status: "fail",
      detail: "в чекауте несохранённые изменения — не трогаю их: возможно, роль пишет сообщение",
    };
  }
  if (facts.ahead > 0) {
    return {
      name,
      status: "fail",
      detail: `в чекауте ${facts.ahead} незапушенных коммитов — контур читал бы почту, которой нет у остальных`,
    };
  }
  if (facts.behind > 0) {
    return {
      name,
      status: "fail",
      detail: `чекаут отстал от origin на ${facts.behind} коммитов и не обновился — работа по вчерашней почте хуже отказа`,
    };
  }
  return { name, status: "ok", detail: `на '${facts.branch}', совпадает с origin` };
};

/** Вердикт по бинарю агента: до аренды, а не фактом неудачного спавна. */
export const agentBinaryVerdict = (exec: string, resolved: string | null): PreflightCheck => ({
  name: "агент: бинарь",
  status: resolved === null ? "fail" : "ok",
  detail:
    resolved === null
      ? `'${exec}' не найден в PATH дочернего процесса — спавн упал бы при уже взятой аренде`
      : resolved,
});

/**
 * Вердикт по среде: показываем ТО, ЧТО УНАСЛЕДУЕТ РЕБЁНОК. Проверка мягкая по
 * построению — пакет не знает, какая версия «правильная» для чужого проекта;
 * его дело показать факт, а не судить о нём.
 */
export const environmentVerdict = (input: {
  readonly nodeVersion: string | null;
  readonly appliedKeys: readonly string[];
}): PreflightCheck => {
  const preamble =
    input.appliedKeys.length === 0
      ? "преамбулы окружения нет"
      : `преамбула: ${input.appliedKeys.join(", ")}`;
  return {
    name: "среда: глазами ребёнка",
    status: "ok",
    detail: `node ${input.nodeVersion ?? "не определился"} · ${preamble}`,
  };
};

export const preflightPassed = (checks: readonly PreflightCheck[]): boolean =>
  checks.every((check) => check.status === "ok");

/**
 * Витрина. Печатается ВСЕГДА целиком, а не только при провале: «что проверено»
 * само по себе ответ на вопрос «о чём мне не надо помнить».
 */
export const renderPreflight = (checks: readonly PreflightCheck[]): string =>
  checks
    .map((check) => `${check.status === "ok" ? "✓" : "✗"} ${check.name}: ${check.detail}`)
    .join("\n");

/**
 * Вердикт по РАБОЧЕМУ репозиторию, куда приземляется сессия. Факт печатается
 * всегда; отказ — только если проект объявил ожидаемую ветку. Пакет не знает,
 * какая ветка «правильная» для чужого репозитория, и выдумывать её не станет.
 */
export const workdirVerdict = (input: {
  readonly branch: string;
  readonly dirty: boolean;
  readonly expectedBranch?: string;
}): PreflightCheck => {
  const state = `${input.branch}${input.dirty ? ", есть несохранённые изменения" : ""}`;
  if (input.expectedBranch !== undefined && input.branch !== input.expectedBranch) {
    return {
      name: "рабочее дерево",
      status: "fail",
      detail: `сессия приземлится на '${input.branch}', а проект ждёт '${input.expectedBranch}'`,
    };
  }
  return { name: "рабочее дерево", status: "ok", detail: state };
};
