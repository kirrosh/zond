/**
 * ARV-193 — regression-floor for the four m-20 stateful probes.
 *
 * Spins up `apis/_mock/server.ts` (an intentionally buggy API) on an
 * ephemeral port, drives `runChecks` against `apis/_mock/spec.json`
 * with the manifest's resource configs, and asserts that every
 * declared bug surfaces as exactly one HIGH finding from its target
 * probe.
 *
 * If a probe stops detecting its target class — anti-FP regression,
 * severity downgrade, schema mismatch — this test is the canary.
 * Update the bug + this assertion together; never silence one half.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

import { runChecks } from "../../src/core/checks/index.ts";
import { startMockServer, type MockServer } from "../../apis/_mock/server.ts";
import type { LifecycleConfig } from "../../src/core/generator/resources-builder.ts";

const SPEC_PATH = join(import.meta.dir, "..", "..", "apis", "_mock", "spec.json");
const RESOURCE = "widgets";

const STATEFUL_CHECKS = [
  "cross_call_references",
  "idempotency_replay",
  "pagination_invariants",
  "lifecycle_transitions",
] as const;

let srv: MockServer;

beforeAll(() => {
  srv = startMockServer({ port: 0 });
});
afterAll(async () => {
  await srv.stop();
});

describe("ARV-193 mock testbed → m-20 stateful probes detect 4/4 declared bugs", () => {
  test("each declared bug surfaces as exactly one HIGH finding from its probe", async () => {
    // Mirror of apis/_mock/.api-resources.yaml. The CLI loads it from
    // disk via `--api`; the regression test hands the same Map in
    // directly so it doesn't need a workspace + DB just to assert
    // probe behaviour.
    const lifecycle: LifecycleConfig = {
      field: "status",
      states: ["draft", "published", "archived"],
      transitions: [
        { from: "draft", to: ["published", "archived"] },
        { from: "published", to: ["archived"] },
      ],
      actions: {
        publish: { endpoint: "POST /widgets/{id}/publish", expectedState: "published" },
      },
    };
    const resourceConfigs = new Map([[
      RESOURCE,
      {
        idempotency: { header: "Idempotency-Key", scope: "endpoint" as const },
        pagination: {
          type: "cursor" as const,
          cursorParam: "starting_after",
          cursorField: "id",
          hasMoreField: "has_more",
          limitParam: "limit",
          defaultLimit: 2,
          itemsField: "data",
        },
        lifecycle,
      },
    ]]);

    const result = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      include: [...STATEFUL_CHECKS],
      resourceConfigs,
      timeoutMs: 5_000,
    });

    const findingsByCheck = new Map<string, number>();
    for (const f of result.data.findings) {
      findingsByCheck.set(f.check, (findingsByCheck.get(f.check) ?? 0) + 1);
    }

    // 4/4 declared bugs detected.
    for (const id of STATEFUL_CHECKS) {
      expect(findingsByCheck.get(id) ?? 0).toBeGreaterThan(0);
    }
    expect(result.high_or_critical).toBeGreaterThanOrEqual(4);

    // Per-probe shape — guards against a check still firing but on a
    // different evidence class than the bug we planted.
    const byCheck = (id: string) => result.data.findings.find((f) => f.check === id);

    const xcall = byCheck("cross_call_references")!;
    expect(xcall.severity).toBe("high");
    expect((xcall.evidence?.state_not_persisted as Array<{ field: string }> | undefined)?.map((d) => d.field))
      .toContain("color");

    const idem = byCheck("idempotency_replay")!;
    expect(idem.severity).toBe("high");
    expect(idem.evidence?.kind).toBe("duplicate_resource");

    const pag = byCheck("pagination_invariants")!;
    expect(pag.severity).toBe("high");
    expect(String(pag.evidence?.kind)).toContain("duplicate_items");
    expect((pag.evidence?.duplicates as string[]).length).toBeGreaterThan(0);

    const life = byCheck("lifecycle_transitions")!;
    expect(life.severity).toBe("high");
    const lifeKinds = String(life.evidence?.kind);
    expect(lifeKinds).toContain("wrong_expected_state");
  });
});
