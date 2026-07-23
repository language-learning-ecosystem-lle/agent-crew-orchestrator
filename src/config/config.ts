/**
 * Конфиг протокола — ОДИН файл в корне репозитория, где протокол используется
 * (решение john, 2026-07-23, тред `012-agent-protocol-package`, msg-022).
 *
 * ПОЧЕМУ ОДИН, А НЕ «файл про роли». Роли — лишь одна секция протокола; рядом
 * живут каталог почты и её ветка, завтра — подключённые транспорты. Заведи
 * `roles.json` отдельно, и через месяц рядом появится второй конфигурационный
 * файл, а «где написано» снова станет вопросом.
 *
 * ПОЧЕМУ В `main`, А НЕ В ВЕТКЕ ПОЧТЫ. Прямая запись в ветку почты — штатный
 * режим протокола, и конфиг прав, лежащий там, означал бы, что агент способен
 * расширить себе права коммитом мимо CI и ревьюера. В `main` изменение прав
 * проходит PR. Побочно исчезают «два корня»: конфиг и файлы, на которые он
 * ссылается (карточки ролей, критерии ревью), лежат в одном дереве.
 *
 * `ROLES.md` УПРАЗДНЁН, а не переехал: таблица стала секцией `roles`, зоны и
 * права — полями, стоп-условия — карточками ролей (`instructions`), проза о
 * модели ролей — документом протокола. Собственного содержания не оставалось
 * ни строки, а два описания одного набора ролей расходятся по построению —
 * тот же вывод, что для INDEX (тред 006) и для `waiting-on` в `_meta.md`.
 */
import { z } from "zod";

import { roleSchema } from "../roles/schema.js";

/** Где живёт почта. Ветка и каталог — данные протокола, а не знание вызывающего. */
export const mailSchema = z.strictObject({
  branch: z.string().min(1),
  dir: z.string().min(1),
});

export const protocolConfigSchema = z.strictObject({
  version: z.literal(1),
  mail: mailSchema,
  roles: z.array(roleSchema).min(1),
});

export type Mail = z.infer<typeof mailSchema>;
export type ProtocolConfig = z.infer<typeof protocolConfigSchema>;

/** Разбор непроверенного значения в конфиг. Бросает ZodError с перечнем претензий. */
export const parseProtocolConfig = (raw: unknown): ProtocolConfig =>
  protocolConfigSchema.parse(raw);

/** Имя конфига по умолчанию — конвенция САМОГО пакета, а не знание о проекте. */
export const DEFAULT_CONFIG_PATH = "agent-protocol.json";
