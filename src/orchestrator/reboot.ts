/**
 * Поведение при перезагрузке машины (S4, решение john по развилке — тред 012,
 * curator 16:25). Пакет поддерживает ОБА режима, проект выбирает при установке;
 * пакет НЕ прописывает себя в систему сам — `systemctl enable` делает человек.
 *
 * Ключевое (item 3 curator, «самое важное»): автостарт поднимает ДЕМОНА, но не
 * включает ЗАПУСКИ. Состояние запусков — это `--enable-flag` (файл на диске),
 * и оно переживает ребут РОВНО в том положении, в каком его оставил john:
 * systemd не превращается молча в «после ребута всё само поехало». Гарантия — по
 * построению: enable-состояние = наличие файла, читается каждый тик; после ребута
 * файл тот же, если лежит на ПОСТОЯННОМ хранилище (не tmpfs). Отсюда — юнит и
 * доки указывают персистентный путь под флаги.
 */
export const REBOOT_MODES = ["systemd", "manual"] as const;
export type RebootMode = (typeof REBOOT_MODES)[number];

/**
 * Строка для `status`: как демон поднят и ЧТО будет после ребута — чтобы «через
 * месяц никто не вспомнил» не наступило. `launchesEnabled` — есть ли
 * `--enable-flag` (персистентное состояние запусков).
 */
export const describeReboot = (mode: RebootMode, launchesEnabled: boolean): string => {
  const launches = launchesEnabled ? "включены" : "выключены";
  if (mode === "manual") {
    return `демон: ручной старт; запуски: ${launches}; после ребута демон нужно поднять руками`;
  }
  const afterReboot = launchesEnabled
    ? "запуски были включены — останутся включёнными"
    : "запуски были выключены — останутся выключенными";
  return `демон: автостарт (systemd); запуски: ${launches}; после ребута демон поднимется сам, ${afterReboot}`;
};

/**
 * systemd unit-файл, запускающий демон. `systemctl enable` — ДЕЙСТВИЕ ЧЕЛОВЕКА,
 * не поведение кода: демон, который сам делает себя постоянным, — тот сюрприз,
 * от которого защищает старт в `disabled`. Флаги обязаны лежать на постоянном
 * хранилище — иначе enable-состояние не переживёт ребут (см. doc-блок).
 */
export const renderSystemdUnit = (params: {
  readonly execStart: string;
  readonly workingDir: string;
  readonly description?: string;
}): string =>
  `[Unit]
Description=${params.description ?? "agent-protocol orchestrator daemon"}
After=network.target

[Service]
Type=simple
WorkingDirectory=${params.workingDir}
ExecStart=${params.execStart}
Restart=on-failure

[Install]
WantedBy=default.target
`;
