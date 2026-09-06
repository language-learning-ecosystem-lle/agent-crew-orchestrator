#!/usr/bin/env node
/**
 * ЦЕНА `base` — из чего состоит самая дорогая строка контура.
 *
 * Постановка — тред `135-base-is-the-biggest-line`. Замер треда `134` разложил ношение контекста
 * по причинам и нашёл, что 44,8% его — это `base`: то, что приезжает в контекст ДО первого
 * действия роли и оттого платится максимальное число раз. Тот замер `base` ОБЪЯСНИЛ, но не
 * разложил. Здесь он раскладывается.
 *
 * ЧТО ТАКОЕ `base` ИЗМЕРИМО: размер контекста на ПЕРВОМ обращении к модели
 * (`input + cache_creation + cache_read` первого assistant-события ленты). Это измеренное число,
 * не оценка.
 *
 * ИЗ ЧЕГО ОН СЛОЖЕН — и что из этого видно из журналов контура:
 *   1. системный промпт харнесса и схемы ВСТРОЕННЫХ инструментов — в ленту не пишутся вовсе;
 *   2. каталог MCP-коннекторов — в ленту пишутся ИМЕНА (`system.init.tools`), не схемы;
 *   3. промпт оркестратора (шаблон `buildLaunchPrompt`) — складывается кодом, но кодом ИЗ ДЕРЕВА
 *      ПРОГОНА, а не с ревизии такта: импорт статический. Единственная составляющая, которая берётся
 *      не на момент такта; вывод печатает ревизию `launch.ts`, которой сложен шаблон, а граница
 *      названа в разделе 4 доки;
 *   4. карточка роли (`instructions` конфига) — восстанавливается точно из истории git на момент
 *      такта;
 *   5. память роли — `MEMORY.md`, харнесс подаёт его как `claudeMd`; файл не под git, поэтому его
 *      длина на момент такта восстанавливается по mtime заметок, на которые он ссылается.
 *
 * КАК ЭТО РАЗДЕЛЯЕТСЯ. Складывать оценки по знакам нельзя: коэффициент «знаков на токен» у
 * русского markdown никем не измерен, и ошибка в нём поехала бы во все составляющие сразу.
 * Поэтому коэффициенты не берутся, а ПОДГОНЯЮТСЯ по самим тактам — МНК:
 *
 *     base = α + β·(число MCP-инструментов) + γ·(знаков в шаблоне+карточке) + δ·(знаков в MEMORY.md)
 *
 * Рычаг подгонки — не искусственный: за окно замера каталог MCP приезжал в разном объёме
 * (от 0 до ~194 инструментов: коннекторы поднимаются не всегда), карточки ролей разной длины и
 * правились семь раз, память трёх ролей отличается в 60 раз и росла. β отвечает на вопрос
 * постановки «сколько стоит каталог инструментов» — вопрос, который здесь не мерился ни разу.
 * α — это то, что не меняется НИКОГДА: харнесс со схемами встроенных инструментов.
 *
 * ЧЕГО ЗАМЕР НЕ ДЕЛАЕТ: он не разбирает α на «системный промпт» и «схемы встроенных
 * инструментов» — из журналов контура это не видно, и никакая арифметика их не разведёт.
 * Он также не считает «первое письмо» составляющей `base`: в ЭТОМ контуре лента треда в промпт
 * НЕ кладётся — роль читает её сама первой командой, и это уже класс `mail-read` замера 134.
 *
 * Запуск (даёт те же числа в чужой руке):
 *   node --import tsx scripts/base-cost.mjs --since 2026-09-01
 * Ничего не пишет и ничего не отправляет.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProtocolConfig } from "../packages/agent-protocol/src/index.ts";
import { buildLaunchPrompt } from "../packages/agent-protocol/src/orchestrator/launch.ts";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/**
 * Дом контура один на репозиторий и лежит В ГЛАВНОМ ЧЕКАУТЕ: рабочее место роли
 * (`.worktrees/<role>`) — тот же репозиторий, но `.orchestrator/` в нём НЕТ. Скрипт лежит рядом с
 * `packages/`, то есть в каком-то из чекаутов, и «рядом со мной» домом контура не является.
 * Поэтому умолчание берётся не от файла скрипта, а от git: `--git-common-dir` у рабочего дерева
 * указывает на `.git` главного чекаута, у главного — на свой собственный.
 */
function repoOfCheckout(dir) {
  try {
    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commonDir) return dirname(commonDir.startsWith("/") ? commonDir : join(dir, commonDir));
  } catch {
    /* не чекаут git — тогда честно остаёмся при каталоге рядом со скриптом */
  }
  return dir;
}

const SCRIPT_CHECKOUT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = flag("repo", repoOfCheckout(SCRIPT_CHECKOUT));
const HOME = flag("home", join(REPO, ".orchestrator"));
const SINCE = flag("since", "2026-09-01");

// Дверь, которая молчит, хуже отсутствующей: без журнала контура считать нечего, и сказать об этом
// надо ИМЕНЕМ пути и флагом, которым это чинится, а не стеком `ENOENT` из первого `readFileSync`.
const missing = ["journal.jsonl", "sessions"].filter((p) => !existsSync(join(HOME, p)));
if (missing.length > 0) {
  console.error(
    [
      `base-cost: дома контура нет — под ${HOME} не найдено: ${missing.join(", ")}`,
      `  репозиторий: ${REPO} (чекаут скрипта: ${SCRIPT_CHECKOUT})`,
      "  укажи чекаут, в котором лежит `.orchestrator/`: --repo <путь> (или сам дом: --home <путь>)",
    ].join("\n"),
  );
  process.exit(1);
}

// ── 1. Журнал контура: живые такты с фактической ценой ──────────────────────────────────────────

const leases = [];
for (const line of readFileSync(join(HOME, "journal.jsonl"), "utf8").split("\n")) {
  if (!line) continue;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    continue;
  }
  if (d.kind !== "lease-released" || !d.usage?.tokens) continue;
  if (d.ts < SINCE) continue;
  leases.push({
    ts: d.ts,
    role: d.role,
    thread: d.thread,
    output: d.output,
    model: d.usage.model,
    costUsd: d.usage.costUsd,
    tokens: d.usage.tokens,
  });
}

// ── 2. Цены моделей — тем же МНК, что в `read-cost.mjs`: нужен только cacheRead ──────────────────

function solve(A, b) {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** МНК по столбцам X на вектор y. Возвращает коэффициенты и среднюю абсолютную ошибку. */
function ols(X, y) {
  const n = X[0].length;
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)),
  );
  const b = Array.from({ length: n }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  const x = solve(A, b);
  if (!x) return null;
  let sae = 0;
  let sse = 0;
  const mean = y.reduce((a, v) => a + v, 0) / y.length;
  let sst = 0;
  for (let k = 0; k < y.length; k++) {
    const pred = X[k].reduce((a, v, i) => a + v * x[i], 0);
    sae += Math.abs(pred - y[k]);
    sse += (pred - y[k]) ** 2;
    sst += (y[k] - mean) ** 2;
  }
  return { coef: x, mae: sae / y.length, r2: sst ? 1 - sse / sst : 0 };
}

const byModel = new Map();
for (const t of leases) {
  if (!byModel.has(t.model)) byModel.set(t.model, []);
  byModel.get(t.model).push(t);
}
const cacheReadPrice = new Map(); // модель → $ за токен cache-read
for (const [model, ts] of byModel) {
  if (ts.length < 20) continue;
  const fit = ols(
    ts.map((t) => [t.tokens.out / 1e6, t.tokens.cacheWrite / 1e6, t.tokens.cacheRead / 1e6]),
    ts.map((t) => t.costUsd),
  );
  if (fit) cacheReadPrice.set(model, fit.coef[2] / 1e6);
}

// ── 3. Восстановление составляющих на момент такта ───────────────────────────────────────────────

const git = (args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });

/** История одного пути: [{ts, sha}], новые первыми. */
const historyCache = new Map();
function historyOf(path) {
  if (!historyCache.has(path)) {
    const out = git(["log", "--format=%cI\t%H", "--", path]).trim();
    historyCache.set(
      path,
      out
        ? out.split("\n").map((l) => {
            const [ts, sha] = l.split("\t");
            return { ts: new Date(ts).toISOString(), sha };
          })
        : [],
    );
  }
  return historyCache.get(path);
}

const blobCache = new Map();
/** Текст файла, каким он был живым на момент `ts`. `null` — если на тот момент его не было. */
function fileAt(path, ts) {
  const rev = historyOf(path).find((c) => c.ts <= ts);
  if (!rev) return null;
  const key = `${rev.sha}:${path}`;
  if (!blobCache.has(key)) {
    try {
      blobCache.set(key, git(["show", key]));
    } catch {
      blobCache.set(key, null);
    }
  }
  return blobCache.get(key);
}

const CONFIG_PATH = "agent-protocol.json";
const configCache = new Map();
/**
 * Конфиг и раскладка «роль → путь карточки» на момент `ts`; `null` — конфига тогда ещё не было.
 *
 * Читается САНКЦИОНИРОВАННОЙ дверью пакета — `loadProtocolConfig` с явным `ref`. Ни живым
 * рабочим деревом, ни `git show` мимо пакета: и то и другое критерий 10 называет в одном
 * перечислении, а перекос у них один — роль или путь её карточки, дописанные в фиче-ветке или
 * изменённые за окно, выглядели бы действующими всё окно назад.
 *
 * `intent` — умолчательный `data`: нужны и пути карточек, и поля почты для `buildLaunchPrompt`,
 * а `policy` вторых не отдаёт намеренно. Версионный гейт на этом окне не срабатывает — замерено:
 * `protocolVersion` во ВСЕХ ревизиях конфига окна равен 25. Окно, пересекающее бамп версии,
 * дверь остановит по имени; это громкий отказ, а не тихое неверное число (см. «непокрытое» в доке).
 *
 * Кеш по sha ревизии: тактов сотни, а ревизий конфига за окно единицы.
 */
function configAt(ts) {
  const rev = historyOf(CONFIG_PATH).find((c) => c.ts <= ts);
  if (!rev) return null;
  if (!configCache.has(rev.sha)) {
    // `fetch: false` — сказано вслух, как требует дверь: ходим по конкретным sha, сеть не нужна.
    // Отказ версионного гейта НЕ глушится: пусть падает с названной причиной, а не считает молча.
    const { config } = loadProtocolConfig({ repo: REPO, ref: rev.sha, fetch: false });
    const cardPathOf = new Map();
    for (const r of config.roles ?? []) {
      const doc = (r.instructions ?? []).find((d) => d.kind === "in-repo" && d.path);
      if (doc) cardPathOf.set(r.id ?? r.name, doc.path);
    }
    configCache.set(rev.sha, { config, cardPathOf });
  }
  return configCache.get(rev.sha);
}

/**
 * Длина `MEMORY.md` роли на момент `ts`. Файл не под git (`.orchestrator/` в `.gitignore`),
 * поэтому история восстанавливается по строкам-указателям: каждая строка ведёт на файл заметки,
 * и mtime этого файла — момент, когда строка появилась. Строки без файла (заголовок, пустые)
 * считаются существовавшими всегда.
 */
const memoryCache = new Map();
function memoryCharsAt(role, ts) {
  if (!memoryCache.has(role)) {
    const dir = join(HOME, "memory", role);
    let lines = [];
    try {
      lines = readFileSync(join(dir, "MEMORY.md"), "utf8").split("\n");
    } catch {
      memoryCache.set(role, null);
      return null;
    }
    memoryCache.set(
      role,
      lines.map((line) => {
        const m = /\]\(([^)]+\.md)\)/.exec(line);
        let born = null;
        if (m) {
          try {
            born = statSync(join(dir, m[1])).mtime.toISOString();
          } catch {
            born = null; // строка ведёт на удалённую заметку — считаем её жившей всегда
          }
        }
        return { chars: line.length + 1, born };
      }),
    );
  }
  const rows = memoryCache.get(role);
  if (!rows) return null;
  return rows.reduce((s, r) => s + (r.born === null || r.born <= ts ? r.chars : 0), 0);
}

/**
 * Ревизия `launch.ts`, которой ЭТОТ прогон складывал шаблон промпта.
 *
 * Шаблон — единственная составляющая, которая берётся НЕ с ревизии такта: `buildLaunchPrompt`
 * импортирован статически, то есть приезжает из дерева прогона. Значит число строки «промпт
 * оркестратора» обязано нести свою ревизию с собой, иначе его нельзя перепроверить чужой рукой.
 *
 * Читается ИЗ ДЕРЕВА ПРОГОНА — из файла, который реально импортировался, а не из `--repo` и не из
 * `origin/main`: `--repo` говорит, где журналы, и может указывать в другой чекаут, а `origin/main`
 * не знает ни о выложенном в дерево старом файле, ни о невлитой ветке. `realpathSync` — потому что
 * рабочий способ запуска «каталог с симлинком на `packages`» описан в доке, и судить надо тот
 * чекаут, куда симлинк ВЕДЁТ.
 *
 * Опознание — ПО СОДЕРЖИМОМУ, а не по `git log`: выложить в дерево старый файл
 * (`git checkout <sha> -- <path>`) историю пути не двигает, и `git log` назвал бы ревизию, которой
 * в дереве нет. Сличается blob файла с blob'ом того же пути на каждой ревизии его истории; берётся
 * НОВЕЙШАЯ совпавшая. Не совпало ни с одной (правка в дереве) — так и печатается, вместе с blob'ом:
 * дверь, которая молчит, хуже отсутствующей, а тихое «ревизия такая-то» тут было бы враньём.
 */
function launchRevision() {
  const path = "packages/agent-protocol/src/orchestrator/launch.ts";
  let file = join(SCRIPT_CHECKOUT, path);
  try {
    file = realpathSync(file);
    const at = (args) =>
      execFileSync("git", ["-C", dirname(file), ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    const blob = at(["hash-object", "--", file]);
    // Путь внутри ЕГО чекаута: под симлинком/подмодулем он может не совпасть с `path` выше.
    const rel = at(["ls-files", "--full-name", "--", file]);
    if (!rel) return { file, blob, error: "файл не под git в дереве прогона" };
    // Пути в `log` — абсолютные: cwd здесь каталог файла, а `rel` считается от корня чекаута.
    for (const line of at(["log", "--format=%H\t%cI", "--", file]).split("\n").filter(Boolean)) {
      const [sha, ts] = line.split("\t");
      let past = null;
      try {
        past = at(["rev-parse", `${sha}:${rel}`]);
      } catch {
        /* на той ревизии путь назывался иначе — переименование, не наш случай */
      }
      if (past === blob) return { file: rel, blob, sha, ts };
    }
    return { file: rel, blob, error: "содержимое не совпало ни с одной ревизией истории пути" };
  } catch (e) {
    return { file, error: `ревизию не прочитать: ${e.message}` };
  }
}

/** Шаблон промпта оркестратора и карточка — ровно так, как их складывает `buildLaunchPrompt`. */
function promptPartsAt(tick) {
  const at = configAt(tick.ts);
  if (!at) return null;
  const path = at.cardPathOf.get(tick.role);
  if (!path) return null;
  const text = fileAt(path, tick.ts);
  if (text === null) return null;
  const { config } = at;
  const mail = {
    command: "node --import tsx packages/agent-protocol/src/cli.ts",
    root: `${config.orchestrator?.mailCheckout ?? ""}/${config.mail?.dir ?? "agent-comms"}`,
    ref: config.orchestrator?.ref ?? "origin/main",
  };
  const common = {
    role: tick.role,
    thread: tick.thread,
    deadline: tick.ts,
    windDownSeconds: 480,
    mail,
  };
  const withCard = buildLaunchPrompt({ ...common, instructions: [{ path, text }] });
  const bare = buildLaunchPrompt({ ...common, instructions: [] });
  return { template: bare.length, card: withCard.length - bare.length };
}

// ── 4. Ленты сессий: измеренный `base`, число обращений и ношение ────────────────────────────────

const sessionFiles = new Map();
for (const f of readdirSync(join(HOME, "sessions"))) {
  if (f.endsWith(".jsonl")) sessionFiles.set(basename(f, ".jsonl"), join(HOME, "sessions", f));
}

/** Возвращает `{base, N, carryBase, carryTotal, mcpTools, resumed}` по ленте одного такта. */
function readSession(path) {
  const events = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* обрезанная строка живой ленты */
    }
  }
  let mcpTools = null;
  const ctxs = [];
  let lastKey = null;
  for (const e of events) {
    if (e.type === "system" && e.subtype === "init" && mcpTools === null)
      mcpTools = (e.tools ?? []).filter((t) => t.startsWith("mcp__")).length;
    if (e.type === "assistant" && e.message?.usage) {
      const u = e.message.usage;
      const key = `${u.cache_read_input_tokens}/${u.cache_creation_input_tokens}`;
      if (key === lastKey) continue; // одно обращение, разбитое на несколько событий
      lastKey = key;
      ctxs.push(
        (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.input_tokens ?? 0),
      );
    }
  }
  if (ctxs.length < 2) return null;
  const N = ctxs.length;
  // Ношение: кусок, приехавший перед обращением k, оплачивается как cache-read в k+1…N−1.
  let carryTotal = ctxs[0] * (N - 1);
  for (let k = 1; k < N; k++) {
    const delta = ctxs[k] - ctxs[k - 1];
    if (delta > 0) carryTotal += delta * (N - 1 - k);
  }
  return { base: ctxs[0], N, carryBase: ctxs[0] * (N - 1), carryTotal, mcpTools: mcpTools ?? 0 };
}

const rows = [];
for (const t of leases) {
  const stem = `${t.ts.slice(0, 19).replace(/:/g, "-")}Z`;
  let path = null;
  if (t.output) {
    const guess = t.output.replace(/\.log$/, ".jsonl");
    if (sessionFiles.has(basename(guess, ".jsonl"))) path = guess;
  }
  if (!path) {
    for (const [k, v] of sessionFiles) {
      if (k.includes(`-${t.role}-${t.thread}`) && k <= stem) path = v;
    }
  }
  if (!path) continue;
  let s;
  try {
    s = readSession(path);
  } catch {
    continue;
  }
  if (!s) continue;
  const parts = promptPartsAt(t);
  const mem = memoryCharsAt(t.role, t.ts);
  if (!parts || mem === null) continue;
  rows.push({ tick: t, ...s, ...parts, mem });
}

// ── 5. Подгонка: из чего сложен `base` ───────────────────────────────────────────────────────────

/**
 * Такт, начатый ПРОДОЛЖЕНИЕМ (R18), карточку заново не получает — его `base` устроен иначе, и в
 * подгонку он не идёт. Признак: `base` заметно меньше самого короткого промпта окна.
 */
const CUT = 20_000;
const fitRows = rows.filter((r) => r.base >= CUT);
const X = fitRows.map((r) => [1, r.mcpTools, r.template + r.card, r.mem]);
const y = fitRows.map((r) => r.base);
const fit = ols(X, y);
if (!fit) {
  console.error("подгонка не сошлась — система вырождена");
  process.exit(1);
}
const [alpha, beta, gamma, delta] = fit.coef;

const fmt = (n, d = 1) => n.toLocaleString("ru-RU", { maximumFractionDigits: d });
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");

console.log(`# Из чего сложен \`base\` — замер по ${rows.length} тактам (с ${SINCE})\n`);
console.log(
  `Подгонка на ${fitRows.length} тактах со свежим промптом (${rows.length - fitRows.length} ` +
    `продолжений R18 отброшены: карточка им не пересылается).\n`,
);

// Шаблон промпта — единственная составляющая, взятая не с ревизии такта. Число, не назвавшее свою
// ревизию, чужой рукой не перепроверяется, а именно это дока обещает первой строкой.
const launchRev = launchRevision();
console.log(
  `Шаблон промпта сложен кодом ИЗ ДЕРЕВА ПРОГОНА, а не с ревизии такта: \`${launchRev.file}\` — ` +
    (launchRev.sha
      ? `ревизия ${launchRev.sha.slice(0, 8)} от ${launchRev.ts}.`
      : `РЕВИЗИЯ НЕ ОПРЕДЕЛЕНА (${launchRev.error}${launchRev.blob ? `, blob ${launchRev.blob.slice(0, 8)}` : ""}).`) +
    ` На тактах, поднятых ДРУГИМ шаблоном, строка «промпт оркестратора» смещена, и смещение` +
    ` впитывает α — см. «Чего замер НЕ покрывает» в \`docs/base-cost-measurement.md\`.\n`,
);
console.log("| коэффициент | значение | что это |");
console.log("| --- | ---: | --- |");
console.log(
  `| α | ${fmt(alpha, 0)} токенов | харнесс: системный промпт + схемы ВСТРОЕННЫХ инструментов (не меняется) |`,
);
console.log(`| β | ${fmt(beta, 1)} токена | на каждый инструмент MCP-коннектора |`);
console.log(`| γ | ${fmt(gamma, 4)} токена/знак | промпт оркестратора и карточка роли |`);
console.log(`| δ | ${fmt(delta, 4)} токена/знак | \`MEMORY.md\` роли |`);
console.log(
  `\nКачество подгонки: R² = ${fit.r2.toFixed(4)}, средняя ошибка ±${fmt(fit.mae, 0)} токенов ` +
    `на такт при среднем \`base\` ${fmt(y.reduce((a, v) => a + v, 0) / y.length, 0)}.\n`,
);

// ── 6. Раскладка ношения `base` по составляющим ─────────────────────────────────────────────────

const COMPONENTS = [
  "харнесс+встроенные",
  "каталог MCP",
  "промпт оркестратора",
  "карточка роли",
  "память роли",
  "невязка",
];
const partsOf = (r) => ({
  "харнесс+встроенные": alpha,
  "каталог MCP": beta * r.mcpTools,
  "промпт оркестратора": gamma * r.template,
  "карточка роли": gamma * r.card,
  "память роли": delta * r.mem,
  невязка: r.base - (alpha + beta * r.mcpTools + gamma * (r.template + r.card) + delta * r.mem),
});

const carry = new Map();
const perRole = new Map();
let carryBase = 0;
let carryTotal = 0;
let baseCost = 0;
for (const r of rows) {
  carryBase += r.carryBase;
  carryTotal += r.carryTotal;
  const price = cacheReadPrice.get(r.tick.model) ?? 0;
  baseCost += r.carryBase * price;
  const p = partsOf(r);
  const share = r.base ? r.carryBase / r.base : 0;
  if (!perRole.has(r.tick.role)) perRole.set(r.tick.role, { ticks: 0, carry: new Map(), cost: 0 });
  const pr = perRole.get(r.tick.role);
  pr.ticks += 1;
  pr.cost += r.carryBase * price;
  for (const c of COMPONENTS) {
    carry.set(c, (carry.get(c) ?? 0) + p[c] * share);
    pr.carry.set(c, (pr.carry.get(c) ?? 0) + p[c] * share);
  }
}

console.log("## Ношение `base`, разложенное по составляющим\n");
console.log("| составляющая | ношение | доля `base` | доля всего ношения | деньги |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const c of COMPONENTS) {
  const v = carry.get(c) ?? 0;
  console.log(
    `| ${c} | ${fmt(v / 1e6, 1)} Mtok | ${pct(v, carryBase)} | ${pct(v, carryTotal)} | $${((v / carryBase) * baseCost).toFixed(2)} |`,
  );
}
console.log(
  `\n**Свёртка.** Сумма составляющих — ${fmt([...carry.values()].reduce((a, b) => a + b, 0) / 1e6, 1)} Mtok, ` +
    `измеренное ношение \`base\` — ${fmt(carryBase / 1e6, 1)} Mtok; \`base\` от всего ношения такта — ` +
    `${pct(carryBase, carryTotal)}, деньгами $${baseCost.toFixed(2)}.\n`,
);

console.log("## По ролям — там, где рычаг\n");
console.log("| роль | тактов | карточка | память | всего `base` | деньги за `base` |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const [role, pr] of [...perRole].sort((a, b) => b[1].cost - a[1].cost)) {
  const total = [...pr.carry.values()].reduce((a, b) => a + b, 0);
  console.log(
    `| ${role} | ${pr.ticks} | ${fmt((pr.carry.get("карточка роли") ?? 0) / 1e6, 1)} Mtok | ` +
      `${fmt((pr.carry.get("память роли") ?? 0) / 1e6, 1)} Mtok | ${fmt(total / 1e6, 1)} Mtok | $${pr.cost.toFixed(2)} |`,
  );
}

console.log("\n## Длины на конец окна (знаков) и разброс, на котором стои́т подгонка\n");
console.log(
  "| роль | карточка | `MEMORY.md` | карточка: min…max | память: min…max | MCP: min…max |",
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const role of perRole.keys()) {
  const mine = rows.filter((r) => r.tick.role === role);
  const rng = (f) => `${fmt(Math.min(...mine.map(f)), 0)}…${fmt(Math.max(...mine.map(f)), 0)}`;
  const last = mine.at(-1);
  console.log(
    `| ${role} | ${fmt(last.card, 0)} | ${fmt(last.mem, 0)} | ${rng((r) => r.card)} | ` +
      `${rng((r) => r.mem)} | ${rng((r) => r.mcpTools)} |`,
  );
}

/**
 * САМОПРОВЕРКА, которая краснеет вслух. α объявлен КОНСТАНТОЙ харнесса — значит невязка подгонки
 * не имеет права систематически зависеть ни от роли, ни от объёма каталога MCP. Если зависит,
 * раскладка что-то приписала не тому слагаемому, и это видно здесь, а не в выводах.
 */
console.log("\n## Невязка по срезам — держится ли α константой\n");
const bucket = (rs, name) => {
  if (!rs.length) return;
  const mean = rs.reduce((s, r) => s + partsOf(r).невязка, 0) / rs.length;
  console.log(`| ${name} | ${rs.length} | ${fmt(mean, 0)} | ${pct(Math.abs(mean), 37_273)} |`);
};
console.log("| срез | тактов | средняя невязка, токенов | от среднего `base` |");
console.log("| --- | ---: | ---: | ---: |");
for (const role of perRole.keys())
  bucket(
    fitRows.filter((r) => r.tick.role === role),
    `роль ${role}`,
  );
bucket(
  fitRows.filter((r) => r.mcpTools === 0),
  "каталог MCP пуст",
);
bucket(
  fitRows.filter((r) => r.mcpTools > 0 && r.mcpTools < 100),
  "каталог MCP 1…99",
);
bucket(
  fitRows.filter((r) => r.mcpTools >= 100),
  "каталог MCP ≥ 100",
);
for (const day of [...new Set(fitRows.map((r) => r.tick.ts.slice(0, 10)))].sort())
  bucket(
    fitRows.filter((r) => r.tick.ts.startsWith(day)),
    day,
  );
