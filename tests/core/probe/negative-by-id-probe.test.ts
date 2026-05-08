import { describe, it, expect } from "bun:test";
import {
  generateNegativeByIdProbes,
  bogusValueFor,
} from "../../../src/core/probe/negative-by-id-probe.ts";
import { ep } from "../../_helpers/endpoints";

const KNOWN_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function methodOf(step: Record<string, unknown>): string {
  const found = KNOWN_METHODS.find((k) => k in step);
  if (!found) throw new Error(`step has no HTTP method: ${JSON.stringify(step)}`);
  return found;
}

describe("generateNegativeByIdProbes (TASK-275)", () => {
  it("emits one suite per parameterized path; skips collection endpoints", () => {
    const result = generateNegativeByIdProbes({
      endpoints: [
        // Collection — no path-param. Skip.
        ep({ method: "GET", path: "/issues" }),
        ep({ method: "POST", path: "/issues" }),
        // Parameterized — probe both methods on /issues/{id}.
        ep({
          method: "GET",
          path: "/issues/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } } as any,
          ],
        }),
        ep({
          method: "DELETE",
          path: "/issues/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });

    expect(result.probedPaths).toBe(1);
    expect(result.skippedPaths).toBe(1);
    expect(result.totalProbes).toBe(2);
    expect(result.suites).toHaveLength(1);

    const suite = result.suites[0]!;
    expect(suite.tags).toContain("negative-by-id");
    expect(suite.tests.map(methodOf).sort()).toEqual(["DELETE", "GET"]);

    for (const t of suite.tests) {
      const statuses = t.expect.status as number[];
      expect(statuses).toEqual([400, 404, 410]);
      // Every URL must contain the bogus integer value.
      const url = t[methodOf(t)] as string;
      expect(url).toContain("999999999");
    }
  });

  it("picks bogus value by schema: uuid → zeroed UUID, integer → 9-digit, slug → marker", () => {
    expect(
      bogusValueFor({
        name: "replay_id",
        in: "path",
        schema: { type: "string", format: "uuid" } as any,
      } as any),
    ).toBe("00000000-0000-0000-0000-000000000000");

    expect(
      bogusValueFor({ name: "issue_id", in: "path", schema: { type: "integer" } as any } as any),
    ).toBe("999999999");

    expect(
      bogusValueFor({ name: "project_slug", in: "path", schema: { type: "string" } as any } as any),
    ).toBe("zond-bogus-slug");

    // Unknown shape falls back to a distinctive generic marker.
    expect(bogusValueFor(undefined)).toBe("zond-bogus-id");
  });

  it("substitutes EVERY path-param with a bogus value, not just one", () => {
    const result = generateNegativeByIdProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/orgs/{org_slug}/projects/{project_id}/issues/{issue_id}",
          parameters: [
            { name: "org_slug", in: "path", required: true, schema: { type: "string" } } as any,
            { name: "project_id", in: "path", required: true, schema: { type: "integer" } } as any,
            { name: "issue_id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    const url = result.suites[0]!.tests[0]![methodOf(result.suites[0]!.tests[0]! as any)] as string;
    expect(url).toBe(
      "/orgs/zond-bogus-slug/projects/999999999/issues/00000000-0000-0000-0000-000000000000",
    );
  });

  it("attaches a JSON body for POST/PUT/PATCH so the body-parser path is reached", () => {
    const result = generateNegativeByIdProbes({
      endpoints: [
        ep({
          method: "PATCH",
          path: "/replays/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
          ],
        }),
        ep({
          method: "GET",
          path: "/replays/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    const patch = result.suites[0]!.tests.find((t) => "PATCH" in t)! as any;
    const get = result.suites[0]!.tests.find((t) => "GET" in t)! as any;
    expect(patch.json).toEqual({});
    expect(get.json).toBeUndefined();
  });

  it("excludes deprecated endpoints", () => {
    const result = generateNegativeByIdProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/legacy/{id}",
          deprecated: true,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    });
    expect(result.probedPaths).toBe(0);
    expect(result.suites).toHaveLength(0);
  });

  it("attaches auth headers when the endpoint declares security", () => {
    const result = generateNegativeByIdProbes({
      endpoints: [
        ep({
          method: "GET",
          path: "/secret/{id}",
          security: ["bearer"],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } } as any,
          ],
        }),
      ],
      securitySchemes: [{ name: "bearer", type: "http", scheme: "bearer" } as any],
    });
    expect(result.suites[0]!.headers).toBeDefined();
  });

  it("is deterministic — same input → same output (idempotent)", () => {
    const input = {
      endpoints: [
        ep({
          method: "GET",
          path: "/x/{id}",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } } as any,
          ],
        }),
      ],
      securitySchemes: [],
    };
    const a = generateNegativeByIdProbes(input);
    const b = generateNegativeByIdProbes(input);
    expect(JSON.stringify(a.suites)).toBe(JSON.stringify(b.suites));
  });
});
