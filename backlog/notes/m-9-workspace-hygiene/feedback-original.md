---
id: m-9-feedback-original
title: "m-9 workspace-hygiene feedback (round 5, file-lifecycle)"
---

# m-9 workspace-hygiene — исходный фидбэк

Структурный обзор воркспейса после ~6 раундов экспериментов с Sentry Public API
(362 файла, 27 MB; 329 — YAML, сгенерированные zond'ом). Получен 2026-05-06.

## Что zond создаёт и где

### 1. Workspace-level (`zond init`) — стабильно, OK

```
zond.config.yml          (~440 байт)
AGENTS.md                (для агента-оператора)
.claude/skills/zond/SKILL.md
.claude/skills/zond-scenarios/SKILL.md
```

### 2. Per-API артефакты (`zond add api --spec`)

```
apis/<name>/spec.json             (3.4 MB на Sentry — копия исходника)
apis/<name>/.api-catalog.yaml     (read-only — навигация)
apis/<name>/.api-resources.yaml   (read-only — CRUD chains)
apis/<name>/.api-fixtures.yaml    (read-only — required vars)
apis/<name>/.env.yaml             (mutable, gitignored — единственный «runtime»)
apis/<name>/.gitignore
```

### 3. Тесты (`zond generate`)

```
apis/sentry/tests/    59 yaml, 472K
  ├─ auth.yaml, sanity.yaml
  ├─ crud-{groups,users}.yaml         (только SCIM выявил detector)
  ├─ smoke-<spec-tag>-{positive,negative,unsafe}.yaml × 18 тегов
  └─ .api-catalog.yaml                ← дубликат root-уровня! (см. P1)
```

### 4. Probes (4 разных subdir'а)

```
apis/sentry/probes/
├─ validation/       134 yaml, 3.7 MB ← гигантская плотность
├─ methods/          130 yaml, 520 K
├─ mass-assignment/    4 yaml, 16 K   + mass-assignment-digest.md (105 KB)
├─ security/           2 yaml, 8 K    ← ручные шаблоны
└─ security-digest{,-v2,-v3,-v4}.md   ← 4 версии, переписывал руками
```

Плюс пустые `security-emit{,-v2,-v3,-v4}/` — `--emit-tests` создал директории
но не положил файлы (см. P5).

### 5. Триаж и отчёты (`zond report`)

```
triage/   12 файлов, ~2.5 MB
  ├─ 7 case-study .md (auto-generated; некоторые TODO-плейсхолдеры)
  └─ 5 *.html run-export'ов (один = 950 KB)
```

---

## Проблемы процесса создания файлов

### P1. `apis/sentry/tests/.api-catalog.yaml` — дубликат root-артефакта

`zond generate` зачем-то кладёт `.api-catalog.yaml` внутрь output-директории
тестов. Это путает с root-уровневым `apis/sentry/.api-catalog.yaml`. Возможно
legacy. Уберите.

### P2. `zond generate` пишет `tests/.env.yaml` поверх API-level

На первой генерации появляется `apis/sentry/tests/.env.yaml` с
`# TODO: fill` плейсхолдерами. Из-за «deeper override» он перебивает
API-level `.env.yaml`. Удалил руками. Поведение сейчас не «merge», а
«полная перезапись».

### P3. Имена файлов: `by-id` × 8 раз = ад читаемости

```
probe-methods-api-0-projects-by-id-by-id-replays-by-id-recording-segments-by-id.yaml
                              ^^ оба placeholder'а сериализованы как "by-id"
```

Сейчас `{organization_id_or_slug}` и `{project_id_or_slug}` оба → `by-id`.
Невозможно глазом понять, какой endpoint без открытия файла. Лучше сохранить
имя placeholder'а:
`…projects-by-org-by-proj-replays-by-replay-recording-segments-by-segment.yaml`
— длиннее, но различимо.

### P4. 134 validation-probe = 3.7 MB на относительно скромном API

Каждый файл — ~28 KB, потому что в нём 8–14 шагов с полностью повторённой
YAML-шапкой (`name`, `tags`, `base_url`, `headers`, `source`). DRY бы дал
× 5 экономии. Опция: общий `_shared.yaml` через `extends:` или вынести
шапку в `apis/<name>/probes/_template.yaml`.

### P5. Пустые директории от `--emit-tests` без 2xx-finding'ов

`zond probe-security … --emit-tests dir/` создаёт `dir/` даже если эмитить
нечего. У меня 4 пустых `security-emit-v*/`. Стоит: либо не создавать
каталог, либо положить EMPTY файл с пояснением.

### P6. Versioning вручную — `digest-v2.md`, v3, v4

Я сам именовал, чтобы не затереть. CLI просто перезаписывает `--output`.
Удобнее было бы:
- если файл существует — auto-suffix `-vN` и подсказка в stdout:
  «previous digest moved to …-v3.md».
- или флаг `--output-pattern '%Y%m%d-%H%M.md'`.

### P7. `triage/` создаёт сам пользователь — нет конвенции

Завёл папку `triage/` руками. zond'у про неё ничего не известно. Стоит:
если есть `--output` без префикса директории, по дефолту класть в
`<workspace>/triage/<api>/<run>/` с timestamps. Тогда rotated-history
появляется бесплатно.

### P8. HTML-report на 950 KB ради 230 шагов — bloat

`triage/sentry-run-12-smoke-sequential.html = 921 KB`. Главный виновник —
full response bodies (Sentry возвращает 30+ KB на GET `/projects/`, со всеми
features/plugins). Опция `--report-body-cap <n>` для HTML-export'а закрыла
бы 90% размера без потери триаж-сигнала. (Та же тема, что в раунде 2 для
case-study — TASK-141.)

### P9. Отсутствует `zond clean`

После 6 раундов экспериментов:
- 4 × `security-digest-v*.md` (нужен только последний)
- 4 × пустых `security-emit-v*/`
- 134 + 130 = 264 probe-yaml в двух директориях, которые после bug-fix'ов
  становятся stale (новые шаблоны).

Нет команды «regenerate from scratch» или «убрать всё, что zond сгенерил,
оставить только tests/, .env.yaml и spec».

### P10. Нет manifest'а «что zond сгенерил»

Пользователь не может отличить «свой» файл от auto-generated. Спасло бы:
- header в каждом авто-файле (сейчас есть в `.api-catalog.yaml` —
  `# Auto-generated by zond. Regenerate with: …`, но не в probe-suites)
- `.zond/manifest.json` со списком сгенерённых путей и их sha256 для
  гарантии «`zond clean` удалит только своё».

---

## Плотность ценности

| Категория                 | Файлов  | Объём  | Ценность |
|---------------------------|---------|--------|----------|
| spec.json                 | 1       | 3.4 MB | 🟢 необходимо |
| catalog/resources/fixtures| 3       | ~80 KB | 🟢 топ ROI |
| .env.yaml                 | 1       | ~700 b | 🟢 топ ROI |
| tests/ smoke+CRUD         | 59      | 472 KB | 🟢 хорошо, но per-spec-tag разбиение слишком мелкое (3 файла на тег × 18 тегов) |
| probes/validation         | 134     | 3.7 MB | 🟡 87% — 404 через nonexistent-zzzzz; после `--use-real-parents` плотность × 10 |
| probes/methods            | 130     | 520 KB | 🟢 1 fail на 431 запрос — хороший сигнал/шум |
| probes/security           | 2 + 4 пустых | 8 KB | 🟢 после probe-security CLI автогенерится |
| triage/*.html             | 5       | 2.4 MB | 🟡 90% — bloat от response bodies |
| triage/*.md case-study    | 7       | 16 KB  | 🟢 ценно |

---

## TL;DR — приоритетные улучшения

1. **`zond clean` + manifest (P9, P10)** — критично для воркспейсов, прошедших несколько итераций.
2. **Не плодить subdirs `tests/.api-catalog.yaml`, `tests/.env.yaml` (P1, P2)** — сейчас они конфликтуют с root.
3. **Имена probe-файлов с реальными placeholder'ами (P3)** — 5-минутная правка генератора, огромный QoL.
4. **Auto-rotation digest'ов (P6) + дефолтная папка `triage/` (P7)** — гигиена «6 раундов в одной сессии».
5. **`--report-body-cap`/`--body-cap` для HTML и case-study (P8)** — × 3 экономия дискового места.
6. **DRY в probe-suites (P4)** — необязательно, но 3.7 MB → ~700 KB на том же контенте.
