---
id: ARV-97
title: checks run --report ndjson --output silently ignored
status: Done
assignee: []
created_date: '2026-05-11 08:15'
updated_date: '2026-05-11 08:23'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F2, class definitely_bug
API: sentry

Repro:
  zond checks run --api sentry --include 'tag:Teams,Organizations' \
    --report ndjson --output .fb-loop/rounds/checks-fresh.ndjson
  ls .fb-loop/rounds/checks-fresh.ndjson   # ENOENT

Expected: создание/перезапись указанного файла (как для --report sarif --output zond.sarif из zond-checks/SKILL.md L73). Если файл уже есть — по политике zond report ротация в <stem>-vN.<ext> или --overwrite.

Actual: команда полностью отрабатывает, события идут в stdout, summary печатается, exit-code корректный — но файла НЕТ. Воспроизведено на двух путях (стейлый checks-01.ndjson не перетёрся; свежий не создан вообще). Тестер случайно проанализировал стейлый Resend-файл, думая что это Sentry-вывод.

Effect: любой CI/SARIF pipeline из cookbook'а ('Full conformance pass on staging, output SARIF for code scanning', zond-checks/SKILL.md L138-139) производит файл — а NDJSON-вариант сейчас тихо теряет данные. Опасно для observation-агентов, парсящих файл вместо stdout.

Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log (блоки '=== checks run --include ===' и '=== checks run --output verify ===')
Related: skill-drift SD3
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 checks run --report ndjson --output <path> writes the file
- [ ] #2 Same path with --report sarif also writes
- [x] #3 Re-running with same --output path overwrites or rotates predictably
- [x] #4 Test added covering ndjson + sarif file emission
<!-- AC:END -->
