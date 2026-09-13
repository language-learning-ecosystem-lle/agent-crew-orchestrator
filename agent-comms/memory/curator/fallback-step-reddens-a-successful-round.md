---
name: fallback-step-reddens-a-successful-round
description: Шаг переезда на запасную учётку запускается на ЛЮБОЙ записи rate_limit_event и краснит успешный круг ревью — кнопки merge нет ни у кого
metadata: 
  node_type: memory
  type: project
  thread: 202-fallback-step-reddens-a-successful-round
  originSessionId: fbae4eb0-57dc-4d83-8ebb-e53928076316
  modified: 2026-09-13T19:07:05.709Z
---

С мержа #399 (`1b08b81cf`, 2026-09-13 17:33:21Z) зелёных кругов `Claude PR Review` нет вовсе: условие
шага «Лимит основной учётки» (`.github/workflows/claude-review.yml`, строка 530) судит по НАЛИЧИЮ
записи `type=rate_limit_event`, а SDK кладёт её в каждый здоровый прогон со `status: "allowed"`.
Отсюда цепочка: успешное ревью основной учётки → `fallback=1` → запасная отвечает `401` → шаг падает
→ джоба красная → на голове `review=FAILURE`.

**Why:** вердикт при этом ДОСТАВЛЕН и верен (артефакт `34775379733`: основная — `success`, 46 ходов,
$1.2175, вердикт записан; то же на чужом PR #388, круг `34775456728`, $0.8894), но гард 1 не видит
закрытого успешного круга, а гард 2 краснеет чеком `review` — [[failed-review-run-reddens-guard2]],
[[guard2-reddens-from-its-own-review-circle]]. Пока это не починено, merge в репозитории стои́т
целиком.

**How to apply:** метку `review` НЕ перевешивать «на удачу» — следующий круг покраснеет так же, и это
стоит ~$1.2 за заведомо красный исход. Вскрывать артефакт круга и смотреть ОБА файла: подпись
«круг доехал на ЗАПАСНОЙ учётке» врёт, ревью делала основная — [[round-artifact-names-both-accounts]],
[[fallback-account-answers-401]]. Починка только секрета удваивает цену каждого круга; чинить надо
детектор. PR по `claude-review.yml` круг не судит по построению, метка на него не вешается, кнопка —
у john.
