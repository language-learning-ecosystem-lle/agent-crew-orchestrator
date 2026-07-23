/**
 * Реестр разговоров как ОТРАЖЕНИЕ тредов (тред 006).
 *
 * `waiting-on` правили руками трое — curator, dev-агенты и уведомитель о merge, —
 * и он расходился с телом тредов. Всё, что правится руками в нескольких местах,
 * расходится по построению, поэтому INDEX не источник, а производное.
 *
 * И следствие, которого в bash-версии не было: раз INDEX производный, **контур
 * не должен от него зависеть**. Если реестр пересобирает CI, то падение сборки
 * означало бы, что вахта и сторож перестали видеть почту — боль 5 (тред 008)
 * один в один. Поэтому «есть ли почта» считается из ТРЕДОВ (`waitingOnOf`), а
 * INDEX остаётся витриной для человека: его расхождение стоит косметики.
 */
import { type Thread, updatedOf, waitingOnOf } from "./thread.js";

const EMPTY = "—";

export const renderIndex = (threads: readonly Thread[]): string => {
  const rows = threads.map((thread) => {
    const waiting = waitingOnOf(thread);
    return `| ${thread.id} | ${thread.meta.participants.join(", ")} | ${thread.meta.status} | ${
      waiting.length === 0 ? EMPTY : waiting.join(", ")
    } | ${updatedOf(thread)} |`;
  });

  return `# Реестр разговоров\n\n| id | participants | status | waiting-on | updated |\n|---|---|---|---|---|\n${rows.join(
    "\n",
  )}\n`;
};

/** Треды, ждущие роль. Это и есть «есть ли почта» — считается из источника, не из INDEX. */
export const threadsWaitingOn = (threads: readonly Thread[], role: string): string[] =>
  threads.filter((thread) => waitingOnOf(thread).includes(role)).map((thread) => thread.id);
