---
id: ARV-367
title: >-
  on-prem/enterprise onboarding friction — corp CA spec-fetch + apiKey auth hint
  (docgen scan)
status: Done
assignee: []
created_date: '2026-07-08 09:22'
updated_date: '2026-07-09 13:39'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Прогон /zond-scan против docgen-ui-service v30 (внутренний Alfa API за self-signed corp CA, gendoc2-dev-sys) вскрыл три friction-точки, которые бьют по decision-8 (zond для маленьких команд — в т.ч. за корпоративным прокси/CA). Ядро и скилл отработали чисто; это UX/onboarding.

MF1 (главное): zond add api --spec <https-url> падает 'self signed certificate in certificate chain' на внутреннем CA. bun-fetch (readOpenApiSpec, core/generator/openapi-reader.ts) использует свой CA-бандл, игнорируя системный keychain, где корп-CA есть. Единственный обход — --insecure (tls.rejectUnauthorized:false), но его auto-mode классификатор блокирует как TLS-weakening (справедливо). curl без -k через системный store качает спек штатно → пришлось качать локально и регистрировать через --spec <file>. Нужно: читать NODE_EXTRA_CA_CERTS / системный trust store перед fallback на --insecure.

MF2: runner (core/runner/http-client.ts:129) всегда идёт с rejectUnauthorized:false безусловно — для internal/dev-таргетов ок, но неявно. Задокументировать + опц. --strict-tls для валидации против публичного API.

UX1: securityScheme apiKey в header Authorization — сервер ждёт сырой токен, а Bearer-префикс дал 401 'not a valid Base-64 string'. zond прикрепил header верно, но подсказки нет. doctor/add api мог бы предупреждать 'scheme=apiKey → raw-токен без Bearer'.

UX2 (stretch, вне scope): dev-стенд захлёбывался на --workers 4 --rate-limit 20 (55 network-error); scan-скилл мог бы авто-снижать concurrency при spike'е connection-reset. Пока — ручной --workers 1 --rate-limit 5.

Полный контекст: ~/Projects/zond-scans/reports/docgen/20260708-120124/report-zond.md. Память feedback_zond_spec_local_file фиксирует local-file как дефолт-паттерн.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond add api --spec <https-url> подхватывает системный trust store / NODE_EXTRA_CA_CERTS при fetch спека — внутренний/корп CA работает без --insecure
- [x] #2 runner TLS-политика (безусловный rejectUnauthorized:false) задокументирована в zond-checks/README; опц. --strict-tls для валидации против публичного API
- [x] #3 doctor (или add api) для apiKey-схемы в Authorization подсказывает: писать raw-токен без Bearer-префикса
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC2: runtime TLS stays lax by default (documented rationale at the tls: line in http-client.ts); opt-in strict verification via ZOND_STRICT_TLS=1 env (one knob covers run/audit/checks/probe without per-command flag plumbing — chose env over --strict-tls flag deliberately). Documented in ZOND.md 'TLS policy' + zond-checks skill iron rule. Verified live against self-signed.badssl.com: strict rejects, lax 200s.
AC3: doctor now warns deterministically when a securityScheme is apiKey in the Authorization header — 'set auth_token to the RAW key, no Bearer prefix'. Verified with a modified petstore-auth spec.
AC1 was done earlier (add api --ca / NODE_EXTRA_CA_CERTS).
UX2 (auto-concurrency downshift) explicitly out of scope per task.
<!-- SECTION:NOTES:END -->
