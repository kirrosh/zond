/**
 * ARV-187: tests for the `zond api annotate` pipeline.
 *
 * zond does NOT call an LLM — agent does. So these tests exercise the
 * parsing/merging halves directly: feed the parser a YAML-as-string
 * representing what an agent would have returned, and assert the
 * resulting patch + audit.
 */

import { describe, test, expect } from "bun:test";
import { parseSeedBodyResponse } from "../../src/cli/commands/api/annotate/seed-bodies.ts";
import { parseLifecycleResponse } from "../../src/cli/commands/api/annotate/lifecycle.ts";
import { parseIdempotencyResponse } from "../../src/cli/commands/api/annotate/idempotency.ts";
import { parsePaginationResponse } from "../../src/cli/commands/api/annotate/pagination.ts";
import { parseReadbackResponse } from "../../src/cli/commands/api/annotate/readback.ts";
import { parseResourcesResponse } from "../../src/cli/commands/api/annotate/resources.ts";
import { mergePatches, renderChangesDiff, type ResourcePatch } from "../../src/cli/commands/api/annotate/overlay.ts";
import type { ResourceSlice } from "../../src/cli/commands/api/annotate/prompts.ts";

const sliceCustomers: ResourceSlice = {
  resource: "customers",
  basePath: "/v1/customers",
  itemPath: "/v1/customers/{id}",
  endpoints: {
    list: { method: "GET", path: "/v1/customers", summary: "List customers" },
    create: {
      method: "POST",
      path: "/v1/customers",
      summary: "Create a customer",
      requestBody: { contentType: "application/x-www-form-urlencoded" },
    },
    read: { method: "GET", path: "/v1/customers/{id}", summary: "Retrieve a customer" },
  },
};

function yaml(text: string): unknown { return Bun.YAML.parse(text); }

describe("parseSeedBodyResponse", () => {
  test("parses valid response → patch with seed_body block", () => {
    const parsed = yaml(`resource: customers
seed_body:
  content_type: application/x-www-form-urlencoded
  body:
    description: 'zond probe customer'
    email: 'probe@example.com'
rationale: 'minimal required fields'
confidence: high
`);
    const draft = parseSeedBodyResponse(parsed, sliceCustomers);
    expect(draft.patch.resource).toBe("customers");
    expect(draft.patch.seed_body).toEqual({
      content_type: "application/x-www-form-urlencoded",
      body: { description: "zond probe customer", email: "probe@example.com" },
    });
    expect(draft.audit.confidence).toBe("high");
  });

  test("defaults content_type to the create endpoint's contentType", () => {
    const parsed = yaml(`resource: customers
seed_body:
  body:
    description: 'no content_type given'
confidence: medium
`);
    const draft = parseSeedBodyResponse(parsed, sliceCustomers);
    expect(draft.patch.seed_body?.content_type).toBe("application/x-www-form-urlencoded");
  });

  test("null seed_body → empty patch + dropped audit", () => {
    const parsed = yaml("resource: customers\nseed_body: null\nrationale: 'cannot seed file uploads'\n");
    const draft = parseSeedBodyResponse(parsed, sliceCustomers);
    expect(draft.patch.seed_body).toBeUndefined();
    expect(draft.audit.dropped).toBe("agent judged endpoint not seedable");
  });

  test("rejects schema-violating output", () => {
    const parsed = yaml("resource: customers\nseed_body:\n  body: 'this should be an object not a string'\n");
    expect(() => parseSeedBodyResponse(parsed, sliceCustomers)).toThrow();
  });
});

describe("parseLifecycleResponse", () => {
  test("parses full state-machine block", () => {
    const parsed = yaml(`resource: subscriptions
lifecycle:
  field: status
  states: [incomplete, active, past_due, canceled]
  transitions:
    - from: incomplete
      to: [active, canceled]
    - from: active
      to: [past_due, canceled]
  actions:
    cancel:
      endpoint: "DELETE /v1/subscriptions/{id}"
      expected_state: canceled
confidence: high
`);
    const draft = parseLifecycleResponse(parsed, { ...sliceCustomers, resource: "subscriptions" });
    expect(draft.patch.lifecycle?.field).toBe("status");
    expect(draft.patch.lifecycle?.states).toContain("active");
    expect(draft.patch.lifecycle?.actions.cancel?.expected_state).toBe("canceled");
  });

  test("null lifecycle drops the patch", () => {
    const parsed = yaml("resource: customers\nlifecycle: null\nconfidence: low\n");
    const draft = parseLifecycleResponse(parsed, sliceCustomers);
    expect(draft.patch.lifecycle).toBeUndefined();
    expect(draft.audit.dropped).toBe("no state machine");
  });
});

describe("parseIdempotencyResponse", () => {
  test("parses Idempotency-Key block", () => {
    const parsed = yaml(`resource: customers
idempotency:
  header: Idempotency-Key
  scope: endpoint
  ignore_response_fields: [created]
confidence: high
`);
    const draft = parseIdempotencyResponse(parsed, sliceCustomers);
    expect(draft.patch.idempotency?.header).toBe("Idempotency-Key");
    expect(draft.patch.idempotency?.ignore_response_fields).toContain("created");
  });

  test("null idempotency drops the patch", () => {
    const parsed = yaml("resource: customers\nidempotency: null\n");
    const draft = parseIdempotencyResponse(parsed, sliceCustomers);
    expect(draft.patch.idempotency).toBeUndefined();
  });
});

describe("parsePaginationResponse", () => {
  test("parses cursor block", () => {
    const parsed = yaml(`resource: customers
pagination:
  type: cursor
  cursor_param: starting_after
  cursor_field: id
  has_more_field: has_more
  limit_param: limit
  default_limit: 3
  items_field: data
confidence: high
`);
    const draft = parsePaginationResponse(parsed, sliceCustomers);
    expect(draft.patch.pagination?.type).toBe("cursor");
    expect(draft.patch.pagination?.cursor_param).toBe("starting_after");
  });
});

describe("parseReadbackResponse", () => {
  test("parses ignore_fields + write_to_read_map", () => {
    const parsed = yaml(`resource: customers
readback_diff:
  ignore_fields: [expand, validate]
  write_to_read_map:
    tax_id_data: tax_ids
confidence: high
`);
    const draft = parseReadbackResponse(parsed, sliceCustomers);
    expect(draft.patch.readback_diff?.ignore_fields).toEqual(["expand", "validate"]);
    expect(draft.patch.readback_diff?.write_to_read_map?.tax_id_data).toBe("tax_ids");
  });

  test("empty hints drop the patch", () => {
    const parsed = yaml("resource: customers\nreadback_diff:\n  ignore_fields: []\n  write_to_read_map: {}\n");
    const draft = parseReadbackResponse(parsed, sliceCustomers);
    expect(draft.patch.readback_diff).toBeUndefined();
    expect(draft.audit.dropped).toBe("empty readback hints");
  });
});

describe("parseResourcesResponse", () => {
  test("filters low-confidence extensions", () => {
    const parsed = yaml(`extensions:
  - resource: events
    basePath: /v1/events
    itemPath: /v1/events/{id}
    idParam: id
    endpoints:
      list: "GET /v1/events"
      read: "GET /v1/events/{id}"
    fkDependencies: []
    confidence: high
  - resource: maybe_logs
    basePath: /v1/logs
    itemPath: /v1/logs/{id}
    idParam: id
    endpoints:
      list: "GET /v1/logs"
    fkDependencies: []
    confidence: medium
`);
    const result = parseResourcesResponse(parsed);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0]!.resource).toBe("events");
    expect(result.audit.droppedLowConfidence).toBe(1);
  });
});

describe("mergePatches", () => {
  const baseSeedPatch: ResourcePatch = {
    resource: "customers",
    seed_body: { body: { name: "old" } },
  };

  test("adds a new field as a change", () => {
    const proposed: ResourcePatch[] = [
      { resource: "customers", idempotency: { header: "Idempotency-Key" } },
    ];
    const result = mergePatches([baseSeedPatch], proposed);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.field).toBe("idempotency");
    expect(result.conflicts).toHaveLength(0);
  });

  test("identical value is a no-op", () => {
    const proposed: ResourcePatch[] = [
      { resource: "customers", seed_body: { body: { name: "old" } } },
    ];
    const result = mergePatches([baseSeedPatch], proposed);
    expect(result.changes).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  test("differing value is a conflict; force=true overwrites", () => {
    const proposed: ResourcePatch[] = [
      { resource: "customers", seed_body: { body: { name: "new" } } },
    ];
    const dryRun = mergePatches([baseSeedPatch], proposed);
    expect(dryRun.conflicts).toHaveLength(1);
    expect(dryRun.patches[0]!.seed_body!.body.name).toBe("old");

    const forced = mergePatches([baseSeedPatch], proposed, { force: true });
    expect(forced.conflicts).toHaveLength(1);
    expect(forced.changes).toHaveLength(1);
    expect(forced.patches[0]!.seed_body!.body.name).toBe("new");
  });
});

describe("renderChangesDiff", () => {
  test("renders + for additions, ! for kept-conflict", () => {
    const result = mergePatches(
      [{ resource: "customers", seed_body: { body: { name: "old" } } }],
      [
        { resource: "customers", seed_body: { body: { name: "new" } } },
        { resource: "customers", idempotency: { header: "Idempotency-Key" } },
      ],
    );
    const diff = renderChangesDiff(result);
    expect(diff).toContain("resource: customers");
    expect(diff).toContain("+ idempotency:");
    expect(diff).toContain("! seed_body:");
    expect(diff).toContain("kept existing");
  });
});
