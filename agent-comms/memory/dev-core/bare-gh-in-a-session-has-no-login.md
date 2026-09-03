---
name: bare-gh-in-a-session-has-no-login
description: "`gh` в сессии роли не залогинен — токен берётся из secrets.envFile инстанса, которому принадлежит чекаут."
metadata: 
  node_type: memory
  type: project
  originSessionId: b2339f15-b1b2-4afa-966c-82e18489e27a
  modified: 2026-09-03T13:08:40.647Z
---

`gh auth status` в поднятой сессии отвечает «not logged into any GitHub hosts», `~/.config/gh/hosts.yml`
пуст, `GH_TOKEN` в среде нет. Это не поломка: с треда `065` креды берёт САМА команда пакета из машинного
конфига (`~/.config/agent-protocol/instances/<инстанс>.json` → `secrets.envFile`), а голый `gh` в bash
мимо неё идёт и падает.

Для этого контура (`agent-crew-orchestrator` = инстанс `hetzner`) файл —
`/home/lle/.config/agent-protocol/secrets.aco.env`; у соседнего контура (`lle-hetzner`) свой, и путать их
нельзя — это та же граница, что в [[aco-session-cannot-reach-lle-repo]].

**Why:** без этого свой `gh pr view/edit` и свой `git push` в сессии выглядят как «нет прав», и рука
тянется чинить не то.

**How to apply:** перед своим вызовом — `set -a; . /home/lle/.config/agent-protocol/secrets.aco.env
>/dev/null 2>&1; set +a` (значения не печатать). Для `git push` по https помощник, а не токен в URL:
`git -c credential.helper='!f(){ echo username=x-access-token; echo "password=$GH_TOKEN"; };f' push …` —
иначе токен уедет в текст ошибки. **Второй `-c credential.https://github.com.helper=` рядом не ставить:**
пустое значение обнуляет ВЕСЬ список помощников, и push снова просит логин. И переменная в файле бывает
`GITHUB_TOKEN`, а помощник читает `$GH_TOKEN` — экспортировать одно в другое.
