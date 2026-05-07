import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  runSecurityProbes,
  formatSecurityDigest,
} from "../../../src/core/probe/security-probe.ts";
import { postEp as ep } from "../../_helpers/endpoints";
import { fetchHarness, mockResource, projectPutGetPair } from "./_helpers/state-machine";

const harness = fetchHarness();
beforeEach(() => harness.install());
afterEach(() => harness.restore());

describe("runSecurityProbes — round-4 fixes", () => {
  it("restore on partial-PUT API uses single-key body and actually rolls state back", async () => {
    const resource = mockResource({
      initial: { id: "p1", name: "PE Koshelev Kirill", subjectPrefix: "" },
      partialPutOnly: true,
    });
    harness.setResponder(resource.responder);

    const { put: putEp, get: getEp } = projectPutGetPair({
      type: "object",
      properties: {
        name: { type: "string" },
        subjectPrefix: { type: "string" },
      },
    });
    const result = await runSecurityProbes({
      endpoints: [putEp, getEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test", id: "p1" },
      classes: ["crlf"],
    });

    expect(resource.current.name).toBe("PE Koshelev Kirill");
    expect(resource.current.subjectPrefix).toBe("");
    expect(JSON.stringify(resource.current)).not.toContain("X-Zond-Injected");
    // Only the spec-shape discovery shot is multi-key; everything afterwards
    // (partial baselines, attacks, restores) must be single-key.
    expect(resource.multiKeyPutCount()).toBe(1);
    expect(result.verdicts[0]!.findings.length).toBeGreaterThan(0);
  });

  it("flags 'no DELETE counterpart' in cleanup error for POST without sibling DELETE", async () => {
    let createdCount = 0;
    harness.setResponder((req) => {
      if (req.method === "POST") {
        createdCount++;
        return { status: 201, body: { id: `wh_${createdCount}` } };
      }
      return { status: 200 };
    });
    const postEp = ep({
      method: "POST",
      path: "/webhooks",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const result = await runSecurityProbes({
      endpoints: [postEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.cleanup?.error).toMatch(/no DELETE counterpart/);
  });

  it("findDeleteCounterpart matches across trailing-slash variants", async () => {
    let leftover: string[] = [];
    harness.setResponder((req) => {
      if (req.method === "POST" && req.url.endsWith("/keys/")) {
        const id = `k_${leftover.length + 1}`;
        leftover.push(id);
        return { status: 201, body: { id } };
      }
      if (req.method === "DELETE") {
        const m = req.url.match(/\/keys\/([^/?]+)/);
        if (m) leftover = leftover.filter(x => x !== m[1]);
        return { status: 204 };
      }
      return { status: 200 };
    });
    const postEp = ep({
      method: "POST",
      path: "/keys/",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/keys/{key_id}/",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "key_id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    await runSecurityProbes({
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    expect(leftover).toEqual([]);
  });

  it("DELETE cleanup retries on transient 404 (eventual consistency, round-5)", async () => {
    let leftover: string[] = [];
    let deleteCount = 0;
    harness.setResponder((req) => {
      if (req.method === "POST") {
        const id = `k_${leftover.length + 1}`;
        leftover.push(id);
        return { status: 201, body: { id } };
      }
      if (req.method === "DELETE") {
        deleteCount++;
        if (deleteCount === 1) return { status: 404, body: { error: "not found" } };
        const m = req.url.match(/\/keys\/([^/?]+)/);
        if (m) leftover = leftover.filter(x => x !== m[1]);
        return { status: 204 };
      }
      return { status: 200 };
    });
    const postEp = ep({
      method: "POST",
      path: "/keys/",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/keys/{key_id}/",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "key_id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      cleanupRetryDelaysMs: [0, 0],
    });
    expect(leftover).toEqual([]);
    expect(result.verdicts[0]!.cleanup?.error).toBeUndefined();
  });

  it("DELETE cleanup reports leak when 404 persists across retries (round-5)", async () => {
    harness.setResponder((req) => {
      if (req.method === "POST") return { status: 201, body: { id: "k_persistent" } };
      if (req.method === "DELETE") return { status: 404, body: { error: "not found" } };
      return { status: 200 };
    });
    const postEp = ep({
      method: "POST",
      path: "/keys/",
      requestBodySchema: { type: "object", properties: { url: { type: "string", format: "uri" } } },
    });
    const delEp = ep({
      method: "DELETE",
      path: "/keys/{key_id}/",
      requestBodySchema: undefined,
      requestBodyContentType: undefined,
      parameters: [
        { name: "key_id", in: "path", required: true, schema: { type: "string" } } as any,
      ],
    });
    const result = await runSecurityProbes({
      endpoints: [postEp, delEp],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      cleanupRetryDelaysMs: [0, 0],
    });
    expect(result.verdicts[0]!.cleanup?.error).toMatch(/persisted across retries/);
  });

  it("digest surfaces a Cleanup failures section when cleanup.error is set", () => {
    const md = formatSecurityDigest(
      {
        classes: ["ssrf"],
        totalEndpoints: 1,
        specProbed: 1,
        verdicts: [
          {
            method: "POST",
            path: "/keys",
            severity: "ok",
            summary: "fields=[url] · OK=3",
            detectedFields: [{ field: "url", class: "ssrf" }],
            findings: [],
            cleanup: {
              attempted: true,
              error: "no DELETE counterpart for POST /keys; possible leaked resource",
            },
          },
        ],
        warnings: [],
      },
      "spec.json",
    );
    expect(md).toContain("⚠️ Cleanup failures");
    expect(md).toContain("no DELETE counterpart");
    expect(md).toContain("🧹 cleanup-failure");
  });
});
