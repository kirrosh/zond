---
id: ARV-30
title: 'zond probe static: --output optional with apis/<api>/probes/static default'
status: Done
assignee: []
created_date: '2026-05-10 08:38'
updated_date: '2026-05-10 08:42'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 07, finding F3, class quirk
Repro: zond probe static --api resend → 'required option --output <dir> not specified'. Прочие probe-подкоманды (mass-assignment, security) --output вообще не имеют.
Expected: либо probe static имеет дефолт вроде apis/<api>/probes/static (по аналогии с generate → apis/<api>/tests/), либо все три probe-подкоманды единообразны.
Actual: artefacts probe static теряются между запусками (тестер пишет в /tmp/...); ассиметрия с другими probe-подкомандами.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-07.log (blocks 'A. zond probe — что это?' и 'I. probe static без --api')
<!-- SECTION:DESCRIPTION:END -->
