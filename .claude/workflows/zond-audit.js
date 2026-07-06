export const meta = {
  name: 'zond-audit',
  description: 'Прогнать zond против целевого API и выдать артефакты тестирования + фидбэк по самому zond',
  whenToUse: 'Замена ralph-loop тестера: воспроизводимый прогон одного API. Вход — args {spec, baseUrl, slug, out, mode}; ключ — через env ZOND_TEST_API_KEY. Артефакты — в out-папке.',
  phases: [
    { title: 'Setup', detail: 'эфемерный workspace, регистрация API, ключ из env' },
    { title: 'Depth', detail: 'детерминированный depth-pass zond в raw/' },
    { title: 'Triage', detail: 'агент пишет report-api.md + report-zond.md' },
  ],
}

// --- Вход -------------------------------------------------------------------
// spec     — URL или путь до OpenAPI/Swagger (обязателен)
// baseUrl  — base URL целевого API (иначе берётся из spec.servers[])
// slug     — короткое имя API (дефолт "target")
// out      — корень артефактов (дефолт "./zond-runs")
// mode     — "safe" (дефолт, без destructive) | "live" (POST/DELETE/seed)
// Ключ API — ТОЛЬКО через env ZOND_TEST_API_KEY, НЕ через args (утечка в журнал).
// args может прийти объектом или JSON-строкой (зависит от слоя вызова) — нормализуем.
const a = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
if (!a.spec) throw new Error('args.spec обязателен (OpenAPI URL или путь)')
const spec = String(a.spec)
const slug = String(a.slug || 'target').replace(/[^a-zA-Z0-9_-]/g, '-')
const baseUrl = a.baseUrl ? String(a.baseUrl) : ''
const out = String(a.out || './zond-runs')
const mode = a.mode === 'live' ? 'live' : 'safe' // безопасный дефолт для headless-прогона
// authFrom — путь к существующему .secrets.yaml (ПУТЬ не секрет; значение не в args).
// Приоритет auth: env ZOND_TEST_API_KEY, иначе копия файла authFrom, иначе без auth.
const authFrom = a.authFrom ? String(a.authFrom) : ''

const RUN_SCHEMA = {
  type: 'object',
  required: ['runDir', 'wsDir', 'authSet', 'authVerified'],
  additionalProperties: false,
  properties: {
    runDir: { type: 'string', description: 'абсолютный путь до <out>/<slug>/<timestamp>' },
    wsDir: { type: 'string', description: 'абсолютный путь до эфемерного workspace прогона' },
    authSet: { type: 'boolean', description: 'true если auth_token записан из ZOND_TEST_API_KEY' },
    authVerified: { type: 'boolean', description: 'true если 1-2 smoke-запроса вернули НЕ 401/403' },
    authNote: { type: 'string', description: 'что показал smoke-check (статусы, какие пути пробовали)' },
    note: { type: 'string' },
  },
}

const REPORT_SCHEMA = {
  type: 'object',
  required: ['reportApi', 'reportZond', 'high', 'medium', 'low', 'zondIssues'],
  additionalProperties: false,
  properties: {
    reportApi: { type: 'string', description: 'абсолютный путь до report-api.md' },
    reportZond: { type: 'string', description: 'абсолютный путь до report-zond.md' },
    high: { type: 'integer' },
    medium: { type: 'integer' },
    low: { type: 'integer' },
    zondIssues: { type: 'integer', description: 'число наблюдений про сам zond (missing-feature/bug/skill-drift)' },
    headline: { type: 'string', description: '1-2 строки главного вывода' },
  },
}

// --- Phase 1: Setup ---------------------------------------------------------
phase('Setup')
const setup = await agent(
  `Ты — setup-стадия аудита zond. Подготовь ИЗОЛИРОВАННЫЙ прогон, ничего не делясь с другими workspace.

Параметры:
- spec: ${spec}
- slug: ${slug}
- baseUrl: ${baseUrl || '(взять из spec.servers[0])'}
- out root: ${out}
- mode: ${mode}

Шаги (bash):
1. TS=$(date +%Y%m%d-%H%M%S); RUN="$(cd ${out} 2>/dev/null && pwd || (mkdir -p ${out} && cd ${out} && pwd))/${slug}/$TS"; WS="$RUN/workspace"; mkdir -p "$RUN/raw" "$WS"
2. Эфемерный workspace через явный корень (walk-up НЕ используем):
   export ZOND_WORKSPACE="$WS"
   cd "$WS"
   zond init --name ${slug}-audit 2>&1 | tee "$RUN/raw/00-init.log"
   zond add api ${slug} --spec "${spec}" 2>&1 | tee -a "$RUN/raw/00-init.log"
   zond use ${slug}
3. baseUrl: если задан "${baseUrl}", убедись что apis/${slug}/.env.yaml содержит base_url: "${baseUrl}" (Edit файла или флаг add api, смотри как zond хранит). Если не задан — оставь из spec.
4. AUTH (приоритет: env → authFrom → без auth). НИКОГДА не печатай значение токена в ответ/лог, не cat/grep .secrets.yaml.
   a) Если env \\$ZOND_TEST_API_KEY непустой — запиши его как auth_token по конвенции zond (прочти .claude/skills/zond/SKILL.md — правило про секреты). Безопасно: printf 'auth_token: "%s"\\n' "\\$ZOND_TEST_API_KEY" >> apis/${slug}/.secrets.yaml (значение не в тексте команды). authSet=true.
   b) Иначе если задан authFrom="${authFrom || ''}" — скопируй файл целиком в новый workspace БЕЗ чтения содержимого: cp "${authFrom}" apis/${slug}/.secrets.yaml (copy, значение не светится). authSet=true.
   c) Иначе authSet=false, продолжай (валидный прогон на 401).
5. AUTH SMOKE-CHECK (до дорогого depth-pass — не жги 20+ минут coverage-фазы на мёртвом токене):
   a. Прочитай apis/${slug}/.api-catalog.yaml (Read tool). Выбери 1-2 GET-эндпоинта БЕЗ path-параметров (path без "{"), БЕЗ обязательных query-параметров, и такие, что этот path не встречается у других методов (чтобы --include по path не задел заодно POST/DELETE и не дал побочный эффект). Предпочитай "retrieve self"/"list" эндпоинты (account, balance, health, ping, customers...).
   b. zond checks run --api ${slug} --include 'path:^<path1>$' --include 'path:^<path2>$' --phase examples --mode positive --workers 1 --rate-limit 5 --report json --output "$RUN/raw/01-auth-smoke.json" 2>&1 | tee -a "$RUN/raw/00-init.log"
   c. Прочитай "$RUN/raw/01-auth-smoke.json", посмотри HTTP-статусы фактических ответов. Если ВСЕ смоук-запросы вернули 401/403 → authVerified=false (токен либо не задан, либо протух/неверный scope — не важно что говорит authSet). Если хотя бы один запрос НЕ 401/403 (честный 404 на выдуманном ID — это НЕ auth-провал, тоже считается success) → authVerified=true. Кратко опиши статусы в authNote.
   d. Если каталог не даёт подходящего кандидата (все GET с обязательными параметрами) — возьми любой GET и смягчи regex; если и это невозможно, authVerified=authSet (best effort), authNote="skip: no smoke-candidate in catalog".
6. zond session start --label "audit-$TS" 2>&1 | tee -a "$RUN/raw/00-init.log"

ЖЁСТКО: никогда не читай/не эхой .secrets.yaml; не вызывай curl/wget/httpie (iron rule zond).
Верни JSON: runDir=$RUN, wsDir=$WS, authSet=(true/false), authVerified=(true/false), authNote.`,
  { label: `setup:${slug}`, phase: 'Setup', schema: RUN_SCHEMA },
)
if (!setup) throw new Error('setup-стадия провалилась')
log(`workspace: ${setup.wsDir} | auth: ${setup.authSet ? 'set' : 'MISSING'} | smoke-check: ${setup.authVerified ? 'OK' : 'FAILED'}${setup.authNote ? ` (${setup.authNote})` : ''}`)
if (!setup.authVerified) {
  throw new Error(`Auth smoke-check провалился — ${setup.authNote || 'все пробные запросы вернули 401/403'}. Depth-фаза (20+ мин на большом API) не запущена, почини auth (env ZOND_TEST_API_KEY или authFrom) и перезапусти.`)
}

// --- Phase 2: Depth (детерминированный pass) --------------------------------
phase('Depth')
const safe = mode === 'safe'
await agent(
  `Ты — depth-стадия. Выполни детерминированный depth-pass zond по API "${slug}". Это ИСПОЛНИТЕЛЬ, не импровизируй методологию — гони команды ниже по порядку, логируй stderr каждой в raw/NN-*.log.

Окружение (обязательно в каждой команде):
  export ZOND_WORKSPACE="${setup.wsDir}"; cd "${setup.wsDir}"
RUN="${setup.runDir}"; RAW="$RUN/raw"; MODE=${mode}

Шаги:
1. Fixtures (single-pass, детерминированно заполняет что нашёл; недостающее дописывается руками/агентом): zond prepare-fixtures --api ${slug} --apply 2>&1 | tee "$RAW/02-fixtures.log"
   zond doctor --api ${slug} --json > "$RAW/03-doctor.json"
3. Generate suites: zond generate --api ${slug} ${safe ? "--include 'method:GET'" : ''} --output apis/${slug}/tests --force 2>&1 | tee "$RAW/15-generate.log"
4. Static spec audit: zond check spec --api ${slug} --json > "$RAW/20-check-spec.json"
5. Depth checks: ${safe
    ? `zond checks run --api ${slug} --include 'method:GET' --phase examples --workers 4 --rate-limit 30 --report ndjson > "$RAW/30-checks.ndjson" 2> "$RAW/30-checks.stderr.log"`
    : `zond checks run --api ${slug} --phase coverage --workers 4 --rate-limit 30 --report ndjson > "$RAW/30-checks.ndjson" 2> "$RAW/30-checks.stderr.log"`}
6. Stateful checks: zond checks run --api ${slug} --check stateful ${safe ? "--include method:GET" : ''} --workers 2 --rate-limit 30 --report ndjson > "$RAW/40-stateful.ndjson" 2> "$RAW/40-stateful.stderr.log"
7. Probes: mkdir -p apis/${slug}/probes/mass-assignment apis/${slug}/probes/security
   zond probe mass-assignment --api ${slug} ${safe ? '--dry-run' : ''} --emit-tests apis/${slug}/probes/mass-assignment --output apis/${slug}/probes/ma-digest.md > "$RAW/50-probe-ma.log" 2>&1
   zond probe security ssrf,crlf,open-redirect --api ${slug} ${safe ? '--dry-run' : ''} --emit-tests apis/${slug}/probes/security > "$RAW/51-probe-sec.log" 2>&1
   ${safe ? '# safe: probes только dry-run (inventory)' : `zond run apis/${slug}/probes/mass-assignment --report json --output "$RAW/52-run-ma.json"; zond run apis/${slug}/probes/security --report json --output "$RAW/53-run-sec.json"`}
8. Run suites (schema-drift): zond run apis/${slug}/tests --rate-limit ${safe ? '5' : 'auto'} --sequential --validate-schema --report json --output "$RAW/60-run.json"
9. Coverage + session end: zond coverage --api ${slug} --union session --json > "$RAW/70-coverage.json"; zond session end 2>&1 | tee "$RAW/70-session-end.log"
10. HTTP status distribution: jq -r 'select(.type=="check_result") | .response.status // "no-response"' "$RAW/30-checks.ndjson" | sort | uniq -c | sort -rn > "$RAW/90-status-dist.txt"

Правила: не прерывайся на ошибке одного шага — логируй и иди дальше. Каждый шаг, который сам упал/повёл себя странно — коротко запиши симптом в "$RAW/99-zond-friction.md" (### <команда> — что ожидал / что вышло / raw-файл): это сырьё для report-zond.md.
Никогда: curl/wget, чтение .secrets.yaml.

Верни одну строку: сколько шагов прошло / сколько дало непустой вывод, и есть ли записи в 99-zond-friction.md.`,
  { label: `depth:${slug}`, phase: 'Depth' },
)

// --- Phase 3: Triage → артефакты --------------------------------------------
phase('Triage')
const report = await agent(
  `Ты — triage-стадия. Прочитай сырьё в ${setup.runDir}/raw/ и напиши ДВА markdown-артефакта. Строго применяй severity-калибровку.

Вход (Read tool): ${setup.runDir}/raw/*.ndjson, *.json, *.log, 99-zond-friction.md, 90-status-dist.txt, 70-coverage.json.

Severity-калибровка (переопределяет raw-severity):
- HIGH только с evidence: 5xx, auth bypass, data leak, конкретный body-schema diff с примером. recommended_action:fix_spec без exploit → демоут в MEDIUM.
- Класс finding'а (один kind+reason) с >20 инстансами → СВЕРНИ в rollup, считай как 1.
- check spec (static): style/doc-rule'ы (missing pattern/additionalProperties/example) → INFO, не LOW.
- Probe matcher false-positives (CRLF на name/description и т.п.) → в report-zond.md, НЕ в API findings.

Артефакт 1 — ${setup.runDir}/report-api.md (находки про API):
  заголовок (slug, spec, mode, endpoints, дата), Headline (1-3 строки), Summary-таблица по source×severity+rollups, HTTP status distribution (из 90-status-dist.txt), HIGH (evidence-backed), MEDIUM (после rollup), Spec-drift rollups (kind|reason|count|example|fix_hint), coverage (test + audit из 70-coverage.json), Coverage gaps.

Артефакт 2 — ${setup.runDir}/report-zond.md (фидбэк про САМ zond = ошибки/проблемы прогона):
  из 99-zond-friction.md + любых аномалий в логах. Секции: Missing-features, UX papercuts, Skill-drift (расхождение skills в workspace vs реальный CLI), Bugs (краши/некорректное поведение). Каждый пункт: repro-команда, expected, actual, raw-ссылка. Если zond отработал чисто — файл с одной строкой "no issues observed".

Верни JSON: пути обоих файлов, счётчики high/medium/low, zondIssues (число пунктов в report-zond.md), headline.`,
  { label: `triage:${slug}`, phase: 'Triage', schema: REPORT_SCHEMA },
)
if (!report) throw new Error('triage-стадия провалилась')

log(`report-api: ${report.reportApi}`)
log(`report-zond: ${report.reportZond} (${report.zondIssues} zond-issues)`)
return {
  runDir: setup.runDir,
  mode,
  authSet: setup.authSet,
  ...report,
}
