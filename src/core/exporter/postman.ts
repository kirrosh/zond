import { basename } from "path";
import type { TestSuite, TestStep, AssertionRule } from "../parser/types.ts";

// ---------------------------------------------------------------------------
// Postman Collection v2.1 types
// ---------------------------------------------------------------------------

interface PostmanInfo {
  name: string;
  schema: string;
}

interface PostmanVariable {
  key: string;
  value: string;
  enabled?: boolean;
}

interface PostmanHeaderEntry {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanQueryEntry {
  key: string;
  value: string;
  disabled?: boolean;
}

interface PostmanUrlObject {
  raw: string;
  host: string[];
  path: string[];
  query?: PostmanQueryEntry[];
}

interface PostmanBodyRaw {
  mode: "raw";
  raw: string;
  options: { raw: { language: "json" } };
}

interface PostmanBodyUrlencoded {
  mode: "urlencoded";
  urlencoded: Array<{ key: string; value: string; enabled: boolean }>;
}

type PostmanBody = PostmanBodyRaw | PostmanBodyUrlencoded;

interface PostmanRequest {
  method: string;
  url: PostmanUrlObject;
  header: PostmanHeaderEntry[];
  body?: PostmanBody;
}

interface PostmanScript {
  type: "text/javascript";
  exec: string[];
}

interface PostmanEvent {
  listen: "test" | "prerequest";
  script: PostmanScript;
}

interface PostmanItem {
  name: string;
  request: PostmanRequest;
  event?: PostmanEvent[];
}

interface PostmanFolder {
  name: string;
  item: PostmanItem[];
}

interface PostmanCollection {
  info: PostmanInfo;
  item: PostmanFolder[];
  variable?: PostmanVariable[];
}

export interface PostmanEnvironment {
  name: string;
  values: Array<{ key: string; value: string; enabled: boolean }>;
}

// ---------------------------------------------------------------------------
// Dynamic variable mapping: zond → Postman
// ---------------------------------------------------------------------------

const DYNAMIC_VAR_MAP: Record<string, string> = {
  $randomString: "$randomAlphaNumeric",
  $randomName: "$randomFullName",
};

/** Replace zond-specific dynamic vars with Postman equivalents inside a string. */
function mapDynamicVars(str: string): string {
  return str.replace(/\{\{(\$[^}]+)\}\}/g, (_match, varName: string) => {
    const mapped = DYNAMIC_VAR_MAP[varName];
    return mapped ? `{{${mapped}}}` : `{{${varName}}}`;
  });
}

/** Apply mapDynamicVars recursively to a JSON value. */
function mapDynamicVarsInValue(value: unknown): unknown {
  if (typeof value === "string") return mapDynamicVars(value);
  if (Array.isArray(value)) return value.map(mapDynamicVarsInValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = mapDynamicVarsInValue(v);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

function buildUrl(
  baseUrl: string | undefined,
  path: string,
  query?: Record<string, string>
): PostmanUrlObject {
  const base = baseUrl ?? "";
  // Avoid double slash between base and path
  const raw = base.endsWith("/") && path.startsWith("/")
    ? base + path.slice(1)
    : base + path;

  // host: if base is a template variable like {{base_url}}, keep as single element
  let host: string[];
  if (!base) {
    host = [];
  } else if (/^\{\{[^}]+\}\}$/.test(base)) {
    host = [base];
  } else {
    try {
      const u = new URL(base);
      host = u.hostname.split(".");
    } catch {
      host = [base];
    }
  }

  // path segments
  const pathSegments = path.split("/").filter((s) => s.length > 0);

  const result: PostmanUrlObject = { raw, host, path: pathSegments };

  if (query && Object.keys(query).length > 0) {
    result.query = Object.entries(query).map(([key, value]) => ({
      key,
      value: mapDynamicVars(value),
      disabled: false,
    }));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

function buildHeaders(suite: TestSuite, step: TestStep): PostmanHeaderEntry[] {
  const merged: Record<string, string> = {
    ...(suite.headers ?? {}),
    ...(step.headers ?? {}),
  };

  // Auto-add Content-Type for json body
  const hasJson = step.json !== undefined;
  const hasForm = step.form !== undefined;
  const contentTypeKey = Object.keys(merged).find(
    (k) => k.toLowerCase() === "content-type"
  );

  if (hasJson && !contentTypeKey) {
    merged["Content-Type"] = "application/json";
  } else if (hasForm && !contentTypeKey) {
    merged["Content-Type"] = "application/x-www-form-urlencoded";
  }

  return Object.entries(merged).map(([key, value]) => ({
    key,
    value: mapDynamicVars(value),
  }));
}

// ---------------------------------------------------------------------------
// Body builder
// ---------------------------------------------------------------------------

function buildBody(step: TestStep): PostmanBody | undefined {
  if (step.json !== undefined) {
    const mapped = mapDynamicVarsInValue(step.json);
    return {
      mode: "raw",
      raw: JSON.stringify(mapped, null, 2),
      options: { raw: { language: "json" } },
    };
  }

  if (step.form !== undefined) {
    return {
      mode: "urlencoded",
      urlencoded: Object.entries(step.form).map(([key, value]) => ({
        key,
        value: mapDynamicVars(value),
        enabled: true,
      })),
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Dot-path → JS accessor
// e.g. "user.email" → "jsonData.user.email"
//      "user.x-field" → "jsonData.user[\"x-field\"]"
// ---------------------------------------------------------------------------

function dotPathToAccessor(dotPath: string, root: string): string {
  const parts = dotPath.split(".");
  let accessor = root;
  for (const part of parts) {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(part)) {
      accessor += `.${part}`;
    } else {
      accessor += `["${part}"]`;
    }
  }
  return accessor;
}

/** Get the parent object and property name for has.property assertions. */
function dotPathToParentAndKey(
  dotPath: string,
  root: string
): { parent: string; key: string } {
  const parts = dotPath.split(".");
  const key = parts[parts.length - 1]!;
  const parentPath = parts.slice(0, -1).join(".");
  const parent = parentPath ? dotPathToAccessor(parentPath, root) : root;
  return { parent, key };
}

// ---------------------------------------------------------------------------
// Assertion script builder
// ---------------------------------------------------------------------------

/** Serialize a value for use in a pm.expect assertion. */
function serializeValue(val: unknown): string {
  return JSON.stringify(val);
}

/** Build JS lines for a single body field assertion rule. */
function buildFieldAssertions(
  dotPath: string,
  rule: AssertionRule,
  warnings: string[]
): string[] {
  const lines: string[] = [];
  const accessor = dotPathToAccessor(dotPath, "jsonData");

  if (rule.capture !== undefined) {
    lines.push(`pm.environment.set(${JSON.stringify(rule.capture)}, ${accessor});`);
  }

  if (rule.type !== undefined) {
    const chai = rule.type === "integer" ? "number" : rule.type;
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} is ${rule.type}`)}, () => pm.expect(${accessor}).to.be.a(${JSON.stringify(chai)}));`
    );
  }

  if (rule.equals !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} equals ${serializeValue(rule.equals)}`)}, () => pm.expect(${accessor}).to.deep.equal(${serializeValue(rule.equals)}));`
    );
  }

  if (rule.not_equals !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} not equals ${serializeValue(rule.not_equals)}`)}, () => pm.expect(${accessor}).to.not.deep.equal(${serializeValue(rule.not_equals)}));`
    );
  }

  if (rule.contains !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} contains ${serializeValue(rule.contains)}`)}, () => pm.expect(${accessor}).to.include(${serializeValue(rule.contains)}));`
    );
  }

  if (rule.not_contains !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} not contains ${serializeValue(rule.not_contains)}`)}, () => pm.expect(${accessor}).to.not.include(${serializeValue(rule.not_contains)}));`
    );
  }

  if (rule.matches !== undefined) {
    // Build a regex literal from the pattern string
    const escaped = rule.matches.replace(/\//g, "\\/");
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} matches regex`)}, () => pm.expect(${accessor}).to.match(/${escaped}/));`
    );
  }

  if (rule.exists !== undefined) {
    const { parent, key } = dotPathToParentAndKey(dotPath, "jsonData");
    if (rule.exists) {
      lines.push(
        `pm.test(${JSON.stringify(`${dotPath} exists`)}, () => pm.expect(${parent}).to.have.property(${JSON.stringify(key)}));`
      );
    } else {
      lines.push(
        `pm.test(${JSON.stringify(`${dotPath} does not exist`)}, () => pm.expect(${parent}).to.not.have.property(${JSON.stringify(key)}));`
      );
    }
  }

  if (rule.gt !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} > ${rule.gt}`)}, () => pm.expect(${accessor}).to.be.above(${rule.gt}));`
    );
  }
  if (rule.gte !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} >= ${rule.gte}`)}, () => pm.expect(${accessor}).to.be.at.least(${rule.gte}));`
    );
  }
  if (rule.lt !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} < ${rule.lt}`)}, () => pm.expect(${accessor}).to.be.below(${rule.lt}));`
    );
  }
  if (rule.lte !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} <= ${rule.lte}`)}, () => pm.expect(${accessor}).to.be.at.most(${rule.lte}));`
    );
  }

  if (rule.length !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} length is ${rule.length}`)}, () => pm.expect(${accessor}).to.have.lengthOf(${rule.length}));`
    );
  }
  if (rule.length_gt !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} length > ${rule.length_gt}`)}, () => pm.expect(${accessor}.length).to.be.above(${rule.length_gt}));`
    );
  }
  if (rule.length_gte !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} length >= ${rule.length_gte}`)}, () => pm.expect(${accessor}.length).to.be.at.least(${rule.length_gte}));`
    );
  }
  if (rule.length_lt !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} length < ${rule.length_lt}`)}, () => pm.expect(${accessor}.length).to.be.below(${rule.length_lt}));`
    );
  }
  if (rule.length_lte !== undefined) {
    lines.push(
      `pm.test(${JSON.stringify(`${dotPath} length <= ${rule.length_lte}`)}, () => pm.expect(${accessor}.length).to.be.at.most(${rule.length_lte}));`
    );
  }

  if (rule.each !== undefined) {
    lines.push(`// WARNING: '${dotPath}.each' assertion cannot be translated to Postman (not supported)`);
    warnings.push(`'${dotPath}.each' assertion skipped — not supported in Postman`);
  }
  if (rule.contains_item !== undefined) {
    lines.push(`// WARNING: '${dotPath}.contains_item' assertion cannot be translated to Postman (not supported)`);
    warnings.push(`'${dotPath}.contains_item' assertion skipped — not supported in Postman`);
  }
  if (rule.set_equals !== undefined) {
    lines.push(`// WARNING: '${dotPath}.set_equals' assertion cannot be translated to Postman (not supported)`);
    warnings.push(`'${dotPath}.set_equals' assertion skipped — not supported in Postman`);
  }

  return lines;
}

function buildTestScript(
  step: TestStep,
  warnings: string[]
): PostmanEvent | undefined {
  const exec: string[] = [];

  const hasBodyAssertions =
    step.expect.body !== undefined && Object.keys(step.expect.body).length > 0;

  if (hasBodyAssertions) {
    exec.push("let jsonData;");
    exec.push("try { jsonData = pm.response.json(); } catch (e) { jsonData = {}; }");
  }

  // Status assertion
  if (step.expect.status !== undefined) {
    if (Array.isArray(step.expect.status)) {
      const codes = step.expect.status;
      const label = codes.join(" or ");
      exec.push(
        `pm.test(${JSON.stringify(`Status is ${label}`)}, () => pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(codes)}));`
      );
    } else {
      exec.push(
        `pm.test(${JSON.stringify(`Status is ${step.expect.status}`)}, () => pm.response.to.have.status(${step.expect.status}));`
      );
    }
  }

  // Duration assertion
  if (step.expect.duration !== undefined) {
    exec.push(
      `pm.test(${JSON.stringify(`Response time < ${step.expect.duration}ms`)}, () => pm.expect(pm.response.responseTime).to.be.below(${step.expect.duration}));`
    );
  }

  // Response header assertions
  if (step.expect.headers) {
    for (const [headerName, headerValue] of Object.entries(step.expect.headers)) {
      exec.push(
        `pm.test(${JSON.stringify(`Header ${headerName}`)}, () => pm.response.to.have.header(${JSON.stringify(headerName)}, ${JSON.stringify(headerValue)}));`
      );
    }
  }

  // Body field assertions
  if (step.expect.body) {
    for (const [dotPath, rule] of Object.entries(step.expect.body)) {
      const fieldLines = buildFieldAssertions(dotPath, rule, warnings);
      exec.push(...fieldLines);
    }
  }

  if (exec.length === 0) return undefined;

  return {
    listen: "test",
    script: { type: "text/javascript", exec },
  };
}

// ---------------------------------------------------------------------------
// Collect template variables from suites (for collection.variable)
// ---------------------------------------------------------------------------

const POSTMAN_DYNAMIC_VARS = new Set([
  "$randomAlphaNumeric",
  "$randomFullName",
  "$randomEmail",
  "$randomInt",
  "$timestamp",
  "$isoTimestamp",
  "$guid",
  "$randomBoolean",
  "$randomColor",
  "$randomHexColor",
  "$randomAbbreviation",
  "$randomIP",
  "$randomIPV6",
  "$randomMACAddress",
  "$randomPassword",
  "$randomLocale",
  "$randomUserAgent",
  "$randomProtocol",
  "$randomSemver",
  "$randomFirstName",
  "$randomLastName",
  "$randomNamePrefix",
  "$randomNameSuffix",
  "$randomJobArea",
  "$randomJobDescriptor",
  "$randomJobTitle",
  "$randomJobType",
  "$randomCity",
  "$randomStreetName",
  "$randomStreetAddress",
  "$randomCountry",
  "$randomCountryCode",
  "$randomLatitude",
  "$randomLongitude",
  "$randomPhoneNumber",
  "$randomPhoneNumberExt",
  "$randomWord",
  "$randomWords",
  "$randomLoremWord",
  "$randomLoremWords",
  "$randomLoremSentence",
  "$randomLoremSentences",
  "$randomLoremParagraph",
  "$randomLoremParagraphs",
  "$randomLoremText",
  "$randomLoremSlug",
  "$randomLoremLines",
  "$randomURL",
  "$randomDomainName",
  "$randomDomainSuffix",
  "$randomDomainWord",
  "$randomEmail",
  "$randomExampleEmail",
  "$randomUserName",
  "$randomFileName",
  "$randomFileType",
  "$randomFileExt",
  "$randomCommonFileName",
  "$randomCommonFileType",
  "$randomCommonFileExt",
  "$randomFilePath",
  "$randomDirectoryPath",
  "$randomMimeType",
  "$randomDateFuture",
  "$randomDatePast",
  "$randomDateRecent",
  "$randomMonth",
  "$randomWeekday",
  "$randomBankAccount",
  "$randomBankAccountName",
  "$randomCreditCardMask",
  "$randomBankAccountBic",
  "$randomBankAccountIban",
  "$randomTransactionType",
  "$randomCurrencyCode",
  "$randomCurrencyName",
  "$randomCurrencySymbol",
  "$randomBitcoin",
  "$randomCompanyName",
  "$randomCompanySuffix",
  "$randomBs",
  "$randomBsAdjective",
  "$randomBsBuzz",
  "$randomBsNoun",
  "$randomCatchPhrase",
  "$randomCatchPhraseAdjective",
  "$randomCatchPhraseDescriptor",
  "$randomCatchPhraseNoun",
  "$randomDatabaseColumn",
  "$randomDatabaseType",
  "$randomDatabaseCollation",
  "$randomDatabaseEngine",
  "$randomDatetimeRange",
  "$randomHackerAbbr",
  "$randomHackerAdjective",
  "$randomHackerIngverb",
  "$randomHackerNoun",
  "$randomHackerPhrase",
  "$randomHackerVerb",
  "$randomHexadecimal",
  "$randomAvatarImage",
  "$randomImageUrl",
  "$randomAbstractImage",
  "$randomAnimalsImage",
  "$randomBusinessImage",
  "$randomCatsImage",
  "$randomCityImage",
  "$randomFoodImage",
  "$randomNightlifeImage",
  "$randomFashionImage",
  "$randomPeopleImage",
  "$randomNatureImage",
  "$randomSportsImage",
  "$randomTransportImage",
  "$randomImageDataUri",
  "$randomProduct",
  "$randomProductAdjective",
  "$randomProductMaterial",
  "$randomProductName",
  "$randomDepartment",
  "$randomProductDescription",
]);

const VAR_TOKEN_RE = /\{\{([^}]+)\}\}/g;

function extractVarsFromString(str: string, vars: Set<string>): void {
  for (const match of str.matchAll(VAR_TOKEN_RE)) {
    const name = match[1]!.trim();
    if (!name.startsWith("$") && !POSTMAN_DYNAMIC_VARS.has(name)) {
      vars.add(name);
    }
  }
}

function extractVarsFromValue(val: unknown, vars: Set<string>): void {
  if (typeof val === "string") {
    extractVarsFromString(val, vars);
  } else if (Array.isArray(val)) {
    for (const item of val) extractVarsFromValue(item, vars);
  } else if (val !== null && typeof val === "object") {
    for (const v of Object.values(val as Record<string, unknown>)) {
      extractVarsFromValue(v, vars);
    }
  }
}

function collectVariables(suites: TestSuite[]): string[] {
  const vars = new Set<string>();

  for (const suite of suites) {
    if (suite.base_url) extractVarsFromString(suite.base_url, vars);
    if (suite.headers) {
      for (const v of Object.values(suite.headers)) extractVarsFromString(v, vars);
    }
    for (const step of suite.tests) {
      extractVarsFromString(step.path, vars);
      if (step.headers) {
        for (const v of Object.values(step.headers)) extractVarsFromString(v, vars);
      }
      if (step.json !== undefined) extractVarsFromValue(step.json, vars);
      if (step.query) {
        for (const v of Object.values(step.query)) extractVarsFromString(v, vars);
      }
    }
  }

  return Array.from(vars).sort();
}

// ---------------------------------------------------------------------------
// Item builder
// ---------------------------------------------------------------------------

function isSetOnlyStep(step: TestStep): boolean {
  // A step with set but no actual HTTP semantics: path is empty or method is GET
  // with no status expectation and no body — these come from `set:` steps in YAML
  return (
    step.set !== undefined &&
    step.path === "" &&
    step.expect.status === undefined &&
    step.expect.body === undefined
  );
}

function buildItem(
  suite: TestSuite,
  step: TestStep,
  warnings: string[]
): PostmanItem | null {
  if (isSetOnlyStep(step)) {
    warnings.push(`Step "${step.name}" in suite "${suite.name}" is a set-only step — skipped (not translatable to Postman)`);
    return null;
  }

  if (step.for_each !== undefined) {
    warnings.push(`Step "${step.name}" in suite "${suite.name}" uses for_each — converted without loop (Postman has no native for_each)`);
  }
  if (step.retry_until !== undefined) {
    warnings.push(`Step "${step.name}" in suite "${suite.name}" uses retry_until — converted without retry logic (Postman has no native retry_until)`);
  }
  if (step.skip_if !== undefined) {
    warnings.push(`Step "${step.name}" in suite "${suite.name}" uses skip_if — converted without skip logic (Postman has no native skip_if)`);
  }

  const url = buildUrl(
    suite.base_url,
    mapDynamicVars(step.path),
    step.query
  );
  const header = buildHeaders(suite, step);
  const body = buildBody(step);

  const request: PostmanRequest = {
    method: step.method,
    url,
    header,
    ...(body !== undefined ? { body } : {}),
  };

  const testEvent = buildTestScript(step, warnings);

  const item: PostmanItem = {
    name: step.name,
    request,
    ...(testEvent !== undefined ? { event: [testEvent] } : {}),
  };

  return item;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildCollectionResult {
  collection: PostmanCollection;
  warnings: string[];
}

export function buildCollection(
  suites: TestSuite[],
  collectionName: string
): BuildCollectionResult {
  const warnings: string[] = [];

  // Setup suites run first (mirrors zond runner behaviour).
  // In Postman, folder order = run order, so setup captures are available to later folders.
  const sorted = [
    ...suites.filter((s) => s.setup),
    ...suites.filter((s) => !s.setup),
  ];

  const folders: PostmanFolder[] = [];

  for (const suite of sorted) {
    const items: PostmanItem[] = [];

    for (const step of suite.tests) {
      const item = buildItem(suite, step, warnings);
      if (item !== null) items.push(item);
    }

    folders.push({ name: suite.name, item: items });
  }

  const varNames = collectVariables(sorted);
  const variables: PostmanVariable[] = varNames.map((key) => ({
    key,
    value: "",
    enabled: true,
  }));

  const collection: PostmanCollection = {
    info: {
      name: collectionName,
      schema: "https://schema.postman.com/json/collection/v2.1.0/collection.json",
    },
    item: folders,
    ...(variables.length > 0 ? { variable: variables } : {}),
  };

  return { collection, warnings };
}

export function buildEnvironment(
  vars: Record<string, string>,
  name: string
): PostmanEnvironment {
  return {
    name,
    values: Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      enabled: true,
    })),
  };
}

export function deriveCollectionName(path: string): string {
  const base = basename(path);
  // Strip known extensions
  return base.replace(/\.(yaml|yml)$/, "") || "Zond Collection";
}
