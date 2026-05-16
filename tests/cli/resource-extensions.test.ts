import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  readResourceMap,
  readResourceExtensions,
  composeResourceMap,
  RESOURCE_LAYER_UPSTREAM,
  RESOURCE_LAYER_EXTENSION,
} from "../../src/cli/commands/discover.ts";

/**
 * ARV-111: `.api-resources.local.yaml` is the user-maintained sibling to
 * `.api-resources.yaml`. It carries extensions (resources/endpoints not
 * present in the OpenAPI spec — typically write-only / SDK-only routes
 * like Sentry's `/store/` ingest). Refresh-api rewrites the main file
 * but leaves the local file untouched, so user edits persist across
 * spec refreshes.
 *
 * These tests pin the merge semantics: extensions append by default,
 * collide-then-override when their `resource` name matches a base entry.
 */
describe("readResourceMap with .api-resources.local.yaml extensions (ARV-111)", () => {
  let tmpDir: string;
  let apiDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `zond-res-ext-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Reset both files between tests — each case writes only what it needs.
    await rm(join(apiDir, ".api-resources.yaml"), { force: true });
    await rm(join(apiDir, ".api-resources.local.yaml"), { force: true });
  });

  const writeBase = (yaml: string) =>
    writeFile(join(apiDir, ".api-resources.yaml"), yaml);
  const writeLocal = (yaml: string) =>
    writeFile(join(apiDir, ".api-resources.local.yaml"), yaml);

  test("returns null when neither file exists", async () => {
    const result = await readResourceMap(apiDir);
    expect(result).toBeNull();
  });

  test("returns base resources when only main file exists", async () => {
    await writeBase([
      "resources:",
      "  - resource: orgs",
      "    basePath: /orgs",
      "    itemPath: /orgs/{slug}",
      "    idParam: slug",
      "    captureField: slug",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /orgs",
      "    fkDependencies: []",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    expect(map?.resources).toHaveLength(1);
    expect(map?.resources[0]!.resource).toBe("orgs");
  });

  test("appends a non-colliding extension to base resources", async () => {
    await writeBase([
      "resources:",
      "  - resource: orgs",
      "    basePath: /orgs",
      "    itemPath: /orgs/{slug}",
      "    idParam: slug",
      "    captureField: slug",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /orgs",
      "    fkDependencies: []",
    ].join("\n"));
    await writeLocal([
      "extensions:",
      "  - resource: sentry-events",
      "    basePath: /api/{project_id}/store",
      "    itemPath: /api/{project_id}/store",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      create: POST /api/{project_id}/store/",
      "    fkDependencies:",
      "      - var: project_id",
      "        param: project_id",
      "        in: path",
      "        ownerResource: projects",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    const names = map!.resources.map(r => r.resource).sort();
    expect(names).toEqual(["orgs", "sentry-events"]);
    const ext = map!.resources.find(r => r.resource === "sentry-events")!;
    expect(ext.endpoints.create).toBe("POST /api/{project_id}/store/");
    expect(ext.fkDependencies[0]!.var).toBe("project_id");
  });

  test("extension with same resource name overrides the base entry", async () => {
    // Spec describes `widgets` as list-only (no create endpoint). User
    // extends it with a custom create route. The merge MUST surface the
    // extended `endpoints.create` so prepare-fixtures --seed picks it up.
    await writeBase([
      "resources:",
      "  - resource: widgets",
      "    basePath: /widgets",
      "    itemPath: /widgets/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /widgets",
      "    fkDependencies: []",
    ].join("\n"));
    await writeLocal([
      "extensions:",
      "  - resource: widgets",
      "    basePath: /widgets",
      "    itemPath: /widgets/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /widgets",
      "      create: POST /widgets",
      "    fkDependencies: []",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    expect(map?.resources).toHaveLength(1);
    expect(map!.resources[0]!.endpoints.create).toBe("POST /widgets");
  });

  test("readResourceExtensions returns [] when local file missing", async () => {
    expect(await readResourceExtensions(apiDir)).toEqual([]);
  });

  test("readResourceExtensions returns [] when local file is empty or malformed", async () => {
    await writeLocal("");
    expect(await readResourceExtensions(apiDir)).toEqual([]);
    await writeLocal("# only comments\n");
    expect(await readResourceExtensions(apiDir)).toEqual([]);
    await writeLocal("extensions:\n");
    expect(await readResourceExtensions(apiDir)).toEqual([]);
  });

  test("local file alone (no main) still returns null — base must exist", async () => {
    // We don't want the extension file to summon a phantom resource map
    // when add-api / refresh-api never ran. Treat the base as a precondition.
    await writeLocal([
      "extensions:",
      "  - resource: ghost",
      "    basePath: /ghost",
      "    itemPath: /ghost/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /ghost",
      "    fkDependencies: []",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    expect(map).toBeNull();
  });

  // ARV-122: refresh-api rewrites only the upstream layer
  // (.api-resources.yaml). The extension layer (.api-resources.local.yaml)
  // must survive — both as a file on disk and as a contributor to the
  // composed map. Simulate the refresh by re-writing the upstream file
  // with new content and re-reading.
  test("ARV-122 regression: refresh-api preserves extension layer in composed map", async () => {
    await writeBase([
      "resources:",
      "  - resource: users",
      "    basePath: /users",
      "    itemPath: /users/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /users",
      "    fkDependencies: []",
    ].join("\n"));
    await writeLocal([
      "extensions:",
      "  - resource: ingest",
      "    basePath: /ingest",
      "    itemPath: /ingest/{id}",
      "    idParam: id",
      "    captureField: event_id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      create: POST /ingest",
      "    fkDependencies: []",
    ].join("\n"));

    const before = await composeResourceMap(apiDir);
    expect(before.entries.map((r) => r.resource).sort()).toEqual(["ingest", "users"]);
    expect(before.provenance.get("ingest")).toBe(RESOURCE_LAYER_EXTENSION);
    expect(before.provenance.get("users")).toBe(RESOURCE_LAYER_UPSTREAM);

    // Simulate refresh-api: upstream rewritten with an extra resource;
    // local file is untouched (refresh-api never writes there).
    await writeBase([
      "resources:",
      "  - resource: users",
      "    basePath: /users",
      "    itemPath: /users/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /users",
      "      create: POST /users",
      "    fkDependencies: []",
      "  - resource: teams",
      "    basePath: /teams",
      "    itemPath: /teams/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /teams",
      "    fkDependencies: []",
    ].join("\n"));

    const after = await composeResourceMap(apiDir);
    expect(after.entries.map((r) => r.resource).sort()).toEqual(["ingest", "teams", "users"]);
    // Extension still wins on its own key, and the new upstream entry
    // shows up with the expected provenance.
    expect(after.provenance.get("ingest")).toBe(RESOURCE_LAYER_EXTENSION);
    expect(after.provenance.get("teams")).toBe(RESOURCE_LAYER_UPSTREAM);
    // And the upstream "users" picked up its newly-added create endpoint.
    const users = after.entries.find((r) => r.resource === "users");
    expect(users?.endpoints.create).toBe("POST /users");
  });
});

/**
 * ARV-169 (m-20): `patches:` is a field-level overlay alongside
 * `extensions:`. Designed for adding readback_diff (and future m-20
 * yaml-blocks: idempotency, pagination, lifecycle) without re-
 * declaring the resource's CRUD wiring.
 */
describe("readResourceMap with patches: (ARV-169)", () => {
  let tmpDir: string;
  let apiDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `zond-res-patches-${Date.now()}`);
    apiDir = join(tmpDir, "apis", "demo");
    await mkdir(apiDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(join(apiDir, ".api-resources.yaml"), { force: true });
    await rm(join(apiDir, ".api-resources.local.yaml"), { force: true });
  });

  const writeBase = (yaml: string) =>
    writeFile(join(apiDir, ".api-resources.yaml"), yaml);
  const writeLocal = (yaml: string) =>
    writeFile(join(apiDir, ".api-resources.local.yaml"), yaml);

  test("patch adds readback_diff onto existing resource without re-declaring CRUD", async () => {
    await writeBase([
      "resources:",
      "  - resource: customers",
      "    basePath: /customers",
      "    itemPath: /customers/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: true",
      "    endpoints:",
      "      list: GET /customers",
      "      create: POST /customers",
      "      read: GET /customers/{id}",
      "    fkDependencies: []",
    ].join("\n"));
    await writeLocal([
      "patches:",
      "  - resource: customers",
      "    readback_diff:",
      "      ignore_fields: [expand, metadata]",
      "      write_to_read_map:",
      "        tax_id_data: tax_ids",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    expect(map?.resources).toHaveLength(1);
    const r = map!.resources[0]!;
    // CRUD wiring preserved from upstream.
    expect(r.basePath).toBe("/customers");
    expect(r.endpoints.create).toBe("POST /customers");
    expect(r.endpoints.read).toBe("GET /customers/{id}");
    // readback_diff layered on.
    expect(r.readback_diff?.ignore_fields).toEqual(["expand", "metadata"]);
    expect(r.readback_diff?.write_to_read_map).toEqual({ tax_id_data: "tax_ids" });
  });

  test("patch for non-existent resource is silently dropped", async () => {
    await writeBase([
      "resources:",
      "  - resource: customers",
      "    basePath: /customers",
      "    itemPath: /customers/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /customers",
      "    fkDependencies: []",
    ].join("\n"));
    await writeLocal([
      "patches:",
      "  - resource: ghosts",
      "    readback_diff:",
      "      ignore_fields: [x]",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    expect(map?.resources.map((r) => r.resource)).toEqual(["customers"]);
    // No readback_diff added — patch silently dropped.
    expect(map!.resources[0]!.readback_diff).toBeUndefined();
  });

  test("patches: and extensions: coexist", async () => {
    await writeBase([
      "resources:",
      "  - resource: customers",
      "    basePath: /customers",
      "    itemPath: /customers/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      list: GET /customers",
      "    fkDependencies: []",
    ].join("\n"));
    await writeLocal([
      "extensions:",
      "  - resource: ingest",
      "    basePath: /ingest",
      "    itemPath: /ingest/{id}",
      "    idParam: id",
      "    captureField: id",
      "    hasFullCrud: false",
      "    endpoints:",
      "      create: POST /ingest",
      "    fkDependencies: []",
      "patches:",
      "  - resource: customers",
      "    readback_diff:",
      "      ignore_fields: [livemode]",
    ].join("\n"));

    const map = await readResourceMap(apiDir);
    expect(map?.resources.map((r) => r.resource).sort()).toEqual(["customers", "ingest"]);
    const customers = map!.resources.find((r) => r.resource === "customers")!;
    expect(customers.readback_diff?.ignore_fields).toEqual(["livemode"]);
  });
});
