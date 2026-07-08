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
const ws = setup.wsDir
const raw = `${setup.runDir}/raw`
const envLine = `export ZOND_WORKSPACE="${ws}"; cd "${ws}"`
const covInc = safe ? "--include 'method:GET'" : ''
const covPhase = safe ? 'examples' : 'coverage'
const statefulInc = safe ? '--include method:GET' : ''
const WINDOW_SCHEMA = {
  type: 'object', required: ['operations'], additionalProperties: false,
  properties: { operations: { type: 'integer', description: 'operations из ПОСЛЕДНЕЙ строки summary этого окна (0 если файла/summary нет)' } },
}

// Prep — локальные/ограниченные шаги, один агент. Заодно обнуляем NDJSON,
// в которые окна будут дописывать.
await agent(
  `Ты — prep-стадия. Выполни РОВНО эти команды ОДНИМ вызовом Bash (весь блок сразу, timeout 600000) — НЕ разбивай на отдельные вызовы: export ZOND_WORKSPACE и cd живут только внутри одного шелла, при разбивке они теряются и zond пишет в чужой репозиторий (ARV-359). Ничего не придумывай, не добавляй флагов.
${envLine}
: > "${raw}/30-checks.ndjson"; : > "${raw}/30-checks.stderr.log"; : > "${raw}/40-stateful.ndjson"; : > "${raw}/40-stateful.stderr.log"
zond prepare-fixtures --api ${slug} --apply 2>&1 | tee "${raw}/02-fixtures.log"
zond doctor --api ${slug} --json > "${raw}/03-doctor.json" 2> "${raw}/03-doctor.stderr.log"
ZOND_WORKSPACE="${ws}" zond generate --api ${slug} ${covInc} --output "${ws}/apis/${slug}/tests" --force 2>&1 | tee "${raw}/15-generate.log"
zond check spec --api ${slug} --json > "${raw}/20-check-spec.json" 2> "${raw}/20-check-spec.stderr.log"
Ответь одной строкой-сводкой.`,
  { label: `prep:${slug}`, phase: 'Depth', model: 'sonnet' },
)

// ── Windowed depth-pass. КЛЮЧЕВОЕ (ARV-342): цикл окон живёт ЗДЕСЬ, в JS
// воркфлоу, а НЕ в голове агента. Каждое окно — отдельный короткий agent на
// ОДНУ команду (~40с, заведомо < 120с bash-лимита); JS решает, когда стоп
// (operations последнего окна < размера окна = последний срез). Прошлые 3
// прогона усекались на ~11-15% именно потому, что агент не собирал цикл из
// прозы и гонял один foreground `checks run`, ловивший SIGTERM на 120с.
async function sweepWindows(kind, cmd, win, maxWindows) {
  let skip = 0, ops = win, total = 0
  for (let i = 0; i < maxWindows && ops >= win; i++) {
    const r = await agent(
      `Запусти РОВНО ОДНУ Bash-команду ниже (она закрывается за <2 мин). Потом верни целое operations из ПОСЛЕДНЕЙ строки {"type":"summary"}, которую она дописала в NDJSON: grep '"type":"summary"' <файл-из-команды> | tail -1 | jq '.summary.operations'. Больше НИЧЕГО не делай, флагов не меняй.
${envLine}
${cmd(skip)}`,
      { label: `${kind}:${skip}`, phase: 'Depth', schema: WINDOW_SCHEMA, model: 'sonnet' },
    )
    ops = r?.operations ?? 0
    total += ops
    log(`${kind} window skip=${skip}: +${ops} ops (total ${total})`)
    skip += win
  }
  return total
}

const covOps = await sweepWindows(
  'cov',
  (skip) => `zond checks run --api ${slug} ${covInc} --phase ${covPhase} --skip-ops ${skip} --max-ops 40 --workers 4 --rate-limit 30 --report ndjson >> "${raw}/30-checks.ndjson" 2>> "${raw}/30-checks.stderr.log"`,
  40, 20,
)
const stOps = await sweepWindows(
  'stateful',
  (skip) => `zond checks run --api ${slug} --check stateful ${statefulInc} --skip-ops ${skip} --max-ops 120 --workers 2 --rate-limit 30 --report ndjson >> "${raw}/40-stateful.ndjson" 2>> "${raw}/40-stateful.stderr.log"`,
  120, 12,
)
log(`depth swept: coverage ${covOps} ops, stateful ${stOps} ops`)

// Finish — probes + два suite-run (m-24 contract-diff) + yaml/compare +
// coverage/session + status-dist. Один агент, каждую live-команду с
// timeout 600000; не прерывается на ошибке одного шага.
await agent(
  `Ты — finish-стадия. Выполни РОВНО эти команды ОДНИМ вызовом Bash (весь блок сразу, timeout 600000) — НЕ разбивай на отдельные вызовы: export ZOND_WORKSPACE и cd теряются между вызовами, тогда 'zond db runs' читает чужой репозиторий и compare сравнивает не те прогоны (ARV-359/360). Не прерывайся на ошибке одного шага — логируй и иди дальше; странности пиши в "${raw}/99-zond-friction.md" (### команда — ожидал/вышло/raw).
${envLine}
mkdir -p "${ws}/apis/${slug}/probes/mass-assignment" "${ws}/apis/${slug}/probes/security"
zond probe mass-assignment --api ${slug} ${safe ? '--dry-run' : `--live --emit-tests "${ws}/apis/${slug}/probes/mass-assignment"`} --output "${ws}/apis/${slug}/probes/ma-digest.md" > "${raw}/50-probe-ma.log" 2>&1
zond probe security ssrf,crlf,open-redirect --api ${slug} ${safe ? '--dry-run' : `--live --emit-tests "${ws}/apis/${slug}/probes/security"`} > "${raw}/51-probe-sec.log" 2>&1
${safe ? '# safe: probes dry-run only' : `zond run "${ws}/apis/${slug}/probes/mass-assignment" --report json --output "${raw}/52-run-ma.json"\nzond run "${ws}/apis/${slug}/probes/security" --report json --output "${raw}/53-run-sec.json"`}
zond run "${ws}/apis/${slug}/tests" --rate-limit ${safe ? '5' : 'auto'} --sequential --validate-schema --report json --output "${raw}/60-run.json"; RUN_A=$(zond db runs --json | jq -r '.data.runs[0].id')
zond run "${ws}/apis/${slug}/tests" --rate-limit ${safe ? '5' : 'auto'} --sequential --validate-schema --report json --output "${raw}/60-run-b.json"; RUN_B=$(zond db runs --json | jq -r '.data.runs[0].id')
echo "RUN_A=$RUN_A RUN_B=$RUN_B" > "${raw}/61-run-ids.txt"
zond db run "$RUN_B" --report yaml > "${raw}/61-run.yaml" 2> "${raw}/61-run.stderr.log"
zond db diagnose "$RUN_B" --report yaml > "${raw}/62-diagnose.yaml" 2> "${raw}/62-diagnose.stderr.log"
zond db compare "$RUN_A" "$RUN_B" --report yaml > "${raw}/63-compare.yaml" 2> "${raw}/63-compare.stderr.log"
zond coverage --api ${slug} --union session --json > "${raw}/70-coverage.json" 2> "${raw}/70-coverage.stderr.log"
zond session end 2>&1 | tee "${raw}/70-session-end.log"
jq -r 'select(.type=="check_result") | .response.status // "no-response"' "${raw}/30-checks.ndjson" | sort | uniq -c | sort -rn > "${raw}/90-status-dist.txt"
Никогда: curl/wget, чтение .secrets.yaml. Ответь одной строкой-сводкой (что прошло, есть ли записи в 99-zond-friction.md).`,
  { label: `finish:${slug}`, phase: 'Depth', model: 'sonnet' },
)

// --- Phase 3: Triage → артефакты --------------------------------------------
phase('Triage')
const report = await agent(
  `Ты — triage-стадия. Прочитай сырьё в ${setup.runDir}/raw/ и напиши ДВА markdown-артефакта. Severity ты назначаешь сам из evidence.

Вход (Read tool): ${setup.runDir}/raw/*.ndjson, *.json, *.log, *.yaml, 99-zond-friction.md, 90-status-dist.txt, 70-coverage.json.

DEPTH BREADTH (ARV-354): depth-pass был окновым (ARV-342), поэтому НИ 70-coverage.json, НИ последняя строка summary одного окна не отражают реальный охват. Агрегат по всем окнам уже посчитан воркфлоу: coverage depth-pass = ${covOps} operations, stateful depth-pass = ${stOps} operations. В отчёте про depth-охват используй ЭТИ числа (или, если хочешь перепроверить, посчитай distinct operation-пути: jq -r 'select(.type=="check_result") | .operation.method+" "+.operation.path' ${raw}/30-checks.ndjson ${raw}/40-stateful.ndjson | sort -u | wc -l). Не бери operations из summary одного окна — это ~10x недооценка.
m-24 артефакты: 61-run.yaml (снапшот прогона), 62-diagnose.yaml (recommended_action-enum + сырой evidence, БЕЗ prose-подсказок), 63-compare.yaml (field-level контракт-дифф RUN_A↔RUN_B: body_changes[] — поле пропало/добавилось/сменило тип, даже если статусы зелёные).

Severity — суждение агента из evidence (ARV-337: zond больше НЕ эмитит severity и НЕ калибрует; находки несут recommended_action-enum + сырой evidence, приоритет назначаешь ты):
- HIGH только с evidence: 5xx, auth bypass, data leak, конкретный body-schema diff с примером. recommended_action:fix_spec без exploit → MEDIUM.
- Класс finding'а (один kind+reason) с >20 инстансами → СВЕРНИ в rollup, считай как 1.
- check spec (static): style/doc-rule'ы (missing pattern/additionalProperties/example) → INFO, не LOW.
- Probe matcher false-positives (CRLF на name/description и т.п.) → в report-zond.md, НЕ в API findings.

Артефакт 1 — ${setup.runDir}/report-api.md (находки про API):
  заголовок (slug, spec, mode, endpoints, дата), Headline (1-3 строки), Summary-таблица по source×severity+rollups, HTTP status distribution (из 90-status-dist.txt), HIGH (evidence-backed), MEDIUM (после rollup), Spec-drift rollups (kind|reason|count|example|fix_hint), Contract-drift (из 63-compare.yaml: status-регрессии RUN_A↔RUN_B + body_changes[] с примером поля; если пусто — "стабилен между прогонами"), coverage (test + audit из 70-coverage.json), Coverage gaps.

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
