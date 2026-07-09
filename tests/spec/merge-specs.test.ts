import { describe, expect, test } from "bun:test";
import { mergeOpenApiDocs } from "../../src/core/spec/merge-specs.ts";

const v1: any = {
  openapi: "3.0.0",
  info: { title: "svc", version: "v1" },
  servers: [{ url: "/svc/" }],
  paths: {
    "/a": { get: {} },
    "/shared": { get: { summary: "from v1" } },
  },
  components: { schemas: { Foo: { type: "object" }, Same: { type: "string" } } },
};

const v2: any = {
  openapi: "3.0.0",
  info: { title: "svc", version: "v2" },
  servers: [{ url: "/svc/" }],
  paths: {
    "/b": { get: {} },
    "/shared": { get: { summary: "from v2" } },
  },
  components: { schemas: { Bar: { type: "object" }, Same: { type: "number" } } },
};

describe("mergeOpenApiDocs", () => {
  test("unions paths, dedupes servers, joins versions, flags collisions", () => {
    const { merged, summary } = mergeOpenApiDocs([
      { source: "v1", doc: v1 },
      { source: "v2", doc: v2 },
    ]);

    // all unique paths present
    expect(Object.keys(merged.paths!).sort()).toEqual(["/a", "/b", "/shared"]);
    // last-wins on the colliding path
    expect((merged.paths!["/shared"] as any).get.summary).toBe("from v2");
    // servers deduped
    expect(merged.servers).toEqual([{ url: "/svc/" }]);
    // versions joined
    expect(merged.info.version).toBe("v1+v2");
    // components unioned
    expect(Object.keys((merged.components!.schemas as any)).sort()).toEqual(["Bar", "Foo", "Same"]);

    // summary reports collisions
    expect(summary.totalPaths).toBe(3);
    expect(summary.pathCollisions).toEqual(["/shared"]);
    // Same: object vs string vs number — differing shape → conflict
    expect(summary.schemaConflicts).toEqual(["schemas.Same"]);
    expect(summary.sources).toEqual([
      { source: "v1", paths: 2 },
      { source: "v2", paths: 2 },
    ]);
  });

  test("single spec passes through without collisions", () => {
    const { merged, summary } = mergeOpenApiDocs([{ source: "only", doc: v1 }]);
    expect(Object.keys(merged.paths!).sort()).toEqual(["/a", "/shared"]);
    expect(summary.pathCollisions).toEqual([]);
    expect(summary.schemaConflicts).toEqual([]);
  });
});
