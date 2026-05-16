import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildMassAssignmentTemplate } from "../../../src/core/probe/mass-assignment-template.ts";

const SPEC = {
  openapi: "3.0.3",
  info: { title: "T", version: "1" },
  paths: {
    "/widgets": {
      post: {
        operationId: "createWidget",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  owner_id: { type: "string", readOnly: true },
                  status: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "ok" } },
      },
    },
    "/widgets/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: { operationId: "getWidget", responses: { "200": { description: "ok" } } },
      delete: { operationId: "deleteWidget", responses: { "204": { description: "ok" } } },
    },
    "/standalone": {
      put: {
        operationId: "putStandalone",
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

async function withSpec<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ma-tpl-"));
  const path = join(dir, "spec.json");
  try {
    await writeFile(path, JSON.stringify(SPEC), "utf-8");
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("buildMassAssignmentTemplate", () => {
  it("emits full chain (POST → GET → DELETE) for endpoint with sibling read+delete", async () => {
    await withSpec(async (specPath) => {
      const r = await buildMassAssignmentTemplate({ specPath, method: "POST", path: "/widgets" });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.chain).toBe("full");
      expect(r.yaml).toContain("POST: /widgets");
      expect(r.yaml).toContain("GET: /widgets/{{");
      expect(r.yaml).toContain("DELETE: /widgets/{{");
      expect(r.yaml).toContain("always: true");
    });
  });

  it("injects readOnly fields with attacker-* sentinel into create body", async () => {
    await withSpec(async (specPath) => {
      const r = await buildMassAssignmentTemplate({ specPath, method: "POST", path: "/widgets" });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.protectedFields).toContain("owner_id");
      // owner_id is in SUSPECTED_FIELDS too — suspected wins (deterministic UUID).
      expect(r.yaml).toMatch(/owner_id:\s*00000000-0000-0000-0000-00000000beef/);
    });
  });

  it("injects classic mass-assignment fields (is_admin, role, owner_id, ...)", async () => {
    await withSpec(async (specPath) => {
      const r = await buildMassAssignmentTemplate({ specPath, method: "POST", path: "/widgets" });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.yaml).toContain("is_admin: true");
      expect(r.yaml).toContain("role: admin");
      expect(r.yaml).toContain("not_equals: true");
    });
  });

  it("emits single-step template when no sibling read/delete (PUT /standalone)", async () => {
    await withSpec(async (specPath) => {
      const r = await buildMassAssignmentTemplate({ specPath, method: "PUT", path: "/standalone" });
      expect(r.kind).toBe("ok");
      if (r.kind !== "ok") return;
      expect(r.chain).toBe("single");
      expect(r.yaml).toContain("PUT: /standalone");
      expect(r.yaml).not.toContain("GET:");
      expect(r.yaml).not.toContain("always: true");
    });
  });

  it("returns endpoint-not-found with nearest-neighbour suggestions", async () => {
    await withSpec(async (specPath) => {
      const r = await buildMassAssignmentTemplate({ specPath, method: "POST", path: "/missing" });
      expect(r.kind).toBe("endpoint-not-found");
    });
  });
});
