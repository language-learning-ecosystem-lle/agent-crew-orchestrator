---
name: merged-by-does-not-name-the-hand
description: "mergedBy/merge-notify печатают `maysway` и для кнопки john, и для merge роли — токен контура есть PAT того же аккаунта"
metadata: 
  node_type: memory
  type: project
  originSessionId: b1ba8716-a31a-4927-9a87-436eda74b740
  modified: 2026-09-03T10:07:23.657Z
---

`gh pr view --json mergedBy` и автоматическое письмо `github` («merged by maysway») называют ОДНО И ТО ЖЕ имя,
когда кнопку нажал john и когда merge сделала роль: `GH_TOKEN` контура — PAT аккаунта `maysway`
(`merge-gate` печатает источник: `token GH_TOKEN ← the environment of the caller`). Замерено 2026-09-03 на
своём merge #230 (`6f0fa92`).

**Why:** dev-core прочёл «#180 — кнопку нажал `maysway` (john)» как доказательство руки john; поле этого не
говорит вовсе, и та же улика через такт оправдала бы self-merge доков власти.

**How to apply:** руку john доказывать гардом, а не полем — `STOP` гарда 4 в ленте + письмо curator «своей
рукой не нажимаю» ДО merge (класс, у которого другой кнопки нет). Своё авторство merge — своим следом гарда 5,
а не `mergedBy`. Связано: [[statement-of-work-ends-at-the-tag]], [[reproduce-with-the-tool-that-measured]].
