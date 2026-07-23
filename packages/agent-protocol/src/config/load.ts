/**
 * Единственная дверь к конфигу протокола.
 *
 * Читать конфиг с диска рабочей копии нельзя: worktree агента стоит на его же
 * feature-ветке, и правка прав, лежащая в этой ветке, выглядела бы для контура
 * действующей — молча. Поэтому чтение идёт через git по ЯВНОМУ ref, и это
 * обязанность пакета, а не дисциплина вызывающих: дисциплину обходят, дверь —
 * нет.
 *
 * `ref` — параметр без умолчания. Умолчание `origin/main` было бы тем же
 * молчаливым допущением с другой стороны: проверка в CI обязана смотреть на
 * голову ветки PR, иначе она скажет «ок» про файл, которого в этом PR нет.
 *
 * Свежесть — часть операции: `origin/*` без `fetch` протухает молча, а старый
 * конфиг неотличим от актуального. Отказ от обновления возможен, но обязан быть
 * ГРОМКИМ у вызывающего (`onStale`).
 */
import { fetchRef, readFileAtRef } from "../fs/git.js";
import { createRoleRegistry, RoleConfigError, type RoleRegistry } from "../roles/registry.js";
import { DEFAULT_CONFIG_PATH, type ProtocolConfig, protocolConfigSchema } from "./config.js";

export type LoadOptions = {
  /** Рабочая копия репозитория, где живёт конфиг (любая ветка — читаем по ref). */
  readonly repo: string;
  /** Явная точка истории: `origin/main`, `HEAD`, sha. Умолчания нет намеренно. */
  readonly ref: string;
  readonly path?: string;
  /** false — не обновлять remote-tracking ref; вызывающий обязан сказать об этом вслух. */
  readonly fetch?: boolean;
};

export type LoadedConfig = {
  readonly config: ProtocolConfig;
  readonly registry: RoleRegistry;
  readonly path: string;
  readonly ref: string;
};

export const loadProtocolConfig = (options: LoadOptions): LoadedConfig => {
  const path = options.path ?? DEFAULT_CONFIG_PATH;
  if (options.fetch !== false) fetchRef(options.repo, options.ref);

  const raw = readFileAtRef(options.repo, options.ref, path);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RoleConfigError([
      `'${path}' на ${options.ref} — не JSON: ${(error as Error).message}`,
    ]);
  }

  const result = protocolConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new RoleConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(корень)"}: ${issue.message}`),
    );
  }

  return {
    config: result.data,
    registry: createRoleRegistry(result.data),
    path,
    ref: options.ref,
  };
};
