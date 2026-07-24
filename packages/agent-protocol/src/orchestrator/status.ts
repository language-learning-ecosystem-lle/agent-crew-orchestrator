/**
 * `status` оркестратора — читаемая витрина свёрнутой аренды (шаг S0, тред 012).
 * Чистая функция: аренда уже свёрнута `foldLeases`, здесь только формат. Смысл
 * шага — увидеть оба пробела в данных ДО всякого спавна: `overdue` (повис) и
 * `exhausted` (потолок попыток) выносятся явными пометками, а не прячутся в
 * колонке состояния.
 */
import type { LeaseView } from "./lease.js";

/** Пометка проблемного состояния связки — то, что оператор обязан заметить. */
const flag = (view: LeaseView): string => {
  if (view.exhausted) return "  ⚠ ИСЧЕРПАНО — дальше не пытаюсь, см. журнал";
  if (view.overdue) return "  ⚠ ПРОСРОЧЕНО — deadline прошёл, аренда ещё жива";
  return "";
};

const line = (view: LeaseView): string => {
  const cols = [
    view.role,
    view.thread,
    view.state,
    `попытка ${view.attempt}`,
    view.deadline === null ? "deadline —" : `deadline ${view.deadline}`,
    view.reason === null ? "" : `(${view.reason})`,
  ]
    .filter((c) => c !== "")
    .join("  ·  ");
  return `${cols}${flag(view)}`;
};

/**
 * Строки состояния по каждой связке (role, thread). Пустая аренда — честная
 * строка «нет активных сессий», а не пустой вывод: молчание неотличимо от сбоя
 * чтения журнала (урок P0), поэтому отсутствие сессий проговаривается.
 */
export const renderStatus = (views: readonly LeaseView[]): string => {
  if (views.length === 0) return "оркестратор: сессий в журнале нет";
  return views.map(line).join("\n");
};
