---
name: review-yml-pr-is-unmeasured-before-merge
description: "PR, правящий claude-review.yml, до мержа не читает ни одна машина — YAML и `bash -n` по блокам `run:` мерит только рука curator"
metadata: 
  node_type: memory
  type: project
  originSessionId: bf31d5ff-9fdf-425d-aa0c-82b300720b4f
  modified: 2026-09-13T09:06:37.517Z
---

PR, который правит `.github/workflows/claude-review.yml`, **до мержа не проверяет ни одна машина**, и
это конъюнкция двух фактов, каждый из которых по отдельности выглядит безобидно:

- круг ревью такому PR не положен ПО ПОСТРОЕНИЮ (действие самопропускается — «Skipping action due to
  workflow validation»), поэтому вердикта нет и гард 1 закрывается человеком;
- `.github/workflows/checks.yml` не содержит ни `actionlint`, ни `yamllint`, ни `shellcheck`
  (замерено 2026-09-05 грепом по файлу): `pnpm lint`/`typecheck`/`test` до YAML воркфлоу не достают.
  `pnpm test` поднимает `.github/scripts/*.test.sh` процессом — то есть скрипты покрыты, а сам
  воркфлоу и шелл внутри его блоков `run:` — нет.

Цена ошибки несимметрична: синтаксическая ошибка ляжет в `main` и сломает КАЖДЫЙ следующий круг
ревью, а обнаружится на первом же чужом PR. Поэтому перед тем, как вести такой PR к кнопке john,
замер делается своей рукой и стоит секунды:

```bash
git show <head>:.github/workflows/claude-review.yml > $D/cr.yml
python3 -c "import yaml; d=yaml.safe_load(open('$D/cr.yml')); print(list(d['jobs']))"
# и bash -n по каждому блоку run: (${{ }} заменить литералом — это не shell)
```

`shellcheck` в контуре НЕ установлен (проверено `command -v`), поэтому статики глубже синтаксиса нет
ни у прогона, ни у роли — это называется вслух, а не подразумевается. Родня: [[green-is-only-the-runners-command]],
[[acceptance-on-the-merged-tree-is-cheap]], [[guard4-reach-ends-at-workflows]].

**Из указателя (перенесено 2026-09-06, оглавление шло за потолок):** круг самопропускается, а в `checks.yml` нет ни actionlint, ни shellcheck: YAML и `bash -n` по блокам `run:` — рука curator

**У гарда 1 с 13.09 ДВЕ формы «круга не будет», и вторая — ОПЦИЯ, а не поведение** (код `76156975`,
PR #370, слово john 2026-09-11, тред `187`; норма — `PROTOCOL.md`, «Журнал едет попутным диффом»).
Первая — выше: круг самопропускается на `claude-review.yml`, и гард 1 закрывает рука. Вторая —
`merge-gate --journals <префиксы>`: диффу, ВСЕ пути которого лежат в журналах ролей, гард 1 не
задаётся вовсе. Ключевое для руки у кнопки: **без флага исключения нет никакого** — документированная
строка процедуры (`--ref origin/main --pr <n> --review-workflow 'Claude PR Review'`) поведения не
меняет; **один путь вне журналов снимает исключение**, и отказ НАЗЫВАЕТ этот путь; снят только гард 1
— гард 4 держится первым, гарды 2, 3 и 5 как были. Мерено `usage` работающего кода, а не докой.
Родня: [[merge-with-match-head-commit]], [[guard4-reach-ends-at-workflows]].
