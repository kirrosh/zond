import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readResourceMap, readResourceExtensions } from "../../src/cli/commands/discover.ts";

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
});
