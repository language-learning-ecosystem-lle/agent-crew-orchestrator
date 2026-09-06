---
name: token-does-not-cross-the-sudo-switch
description: "Роль с systemUser не видит ни токена контура, ни его secrets.env — две ограды, и выдача токена сама по себе ничего не чинит."
metadata: 
  node_type: memory
  type: project
  originSessionId: decfb544-edc8-45bf-9b6b-fe3e7306be45
  modified: 2026-09-06T12:45:29.527Z
---

Сессия, поднятая через `sudo -n -u <systemUser>`, кредитала контура НЕ получает — по двум
независимым причинам, и обе стоят намеренно:

1. **`env_reset`.** `env_keep` правила `/etc/sudoers.d/aco-devops-spawn` — ровно пять имён
   (`AGENT_PROTOCOL_WORKER`, `…_SESSION_FILE`, `…_WAIT_SECONDS`, `…_LEASE_DEADLINE`,
   `CLAUDE_CONFIG_DIR`). Имени кредитала там нет, поэтому `GH_TOKEN` и хелпер `GIT_CONFIG_*`,
   которые обычная роль получает наследованием от демона, через переход не едут;
2. **конфиг ищется в доме ТОГО, кто бежит.** `localConfigHome` (`config/local.ts`) =
   `XDG_CONFIG_HOME ?? $HOME/.config`, а `sudo -u` даёт ребёнку `HOME` цели. Дом цели пуст →
   `platformEnvOf` отказывает «the machine config of '<repo>' was not read». Конфиг демона она и
   не прочтёт: каталог `drwxrwx--- <демон>`, `secrets.env` `-rw------- <демон>`.

**Практическое:** «выдать роли токен» её не чинит, а расширять `env_keep` не нужно — токену надо
не переезжать через переход, а ЛЕЖАТЬ по ту сторону: свой `secrets.env` (600) + копия конфига
инстанса в доме её пользователя. Это же делает «свой, а не одолженный токен» свойством построения.

И отказ об этом сегодня МОЛЧИТ: `gitIn` (`cli.ts`) собирает `platformEnvOf` строкой выше, но в
`DeliveryRefusedError` его не приклеивает — наружу выходит голое `git fetch … failed (code 128)`,
которое читается как «нет сети». Ср. [[silence-claim-is-checked-in-notify-state]],
[[green-on-the-box-may-lean-on-the-box-token]].
