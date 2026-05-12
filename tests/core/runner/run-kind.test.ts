/**
 * ARV-55: unit tests for `detectRunKind` — the single classifier that
 * decides what `runs.run_kind` to persist at INSERT time.
 *
 * The contract:
 *   - all paths under `…/probes/…`        → 'probe'
 *   - all paths under `…/checks/…`        → 'check'
 *   - any other shape (incl. mixed runs)  → 'regular'
 *   - empty input or all-null input       → 'regular'
 */
import { describe, test, expect } from "bun:test";

import { detectRunKind } from "../../../src/core/runner/run-kind.ts";

describe("ARV-55: detectRunKind", () => {
  test("pure probe run → 'probe'", () => {
    expect(detectRunKind([
      "apis/resend/probes/static/POST_emails-validation.yaml",
      "apis/resend/probes/static/GET_domains-validation.yaml",
    ])).toBe("probe");
  });

  test("nested probe paths (mass-assignment) still classify as probe", () => {
    expect(detectRunKind([
      "apis/r/probes/mass-assignment/POST_users.yaml",
      "apis/r/probes/security/ssrf/POST_webhooks.yaml",
    ])).toBe("probe");
  });

  test("pure check run → 'check'", () => {
    expect(detectRunKind([
      "apis/resend/checks/status-code.yaml",
      "apis/resend/checks/content-type.yaml",
    ])).toBe("check");
  });

  test("mixed probe + test → 'regular' (the run carried real coverage)", () => {
    expect(detectRunKind([
      "apis/resend/probes/static/POST_emails-validation.yaml",
      "apis/resend/tests/smoke-domains-positive.yaml",
    ])).toBe("regular");
  });

  test("pure test run → 'regular'", () => {
    expect(detectRunKind([
      "apis/resend/tests/smoke-domains-positive.yaml",
    ])).toBe("regular");
  });

  test("mixed probe + check is regular (kind is not a free-form set)", () => {
    expect(detectRunKind([
      "apis/r/probes/static/x.yaml",
      "apis/r/checks/y.yaml",
    ])).toBe("regular");
  });

  test("empty input → 'regular' (DB CHECK refuses NULL)", () => {
    expect(detectRunKind([])).toBe("regular");
  });

  test("all-null input → 'regular'", () => {
    expect(detectRunKind([null, undefined])).toBe("regular");
  });

  test("matches mid-path segments — `probes` deep inside a workspace", () => {
    expect(detectRunKind([
      "/abs/workspace/apis/r/probes/static/x.yaml",
    ])).toBe("probe");
  });

  test("does NOT match suffix-only paths like `myprobes.yaml`", () => {
    // Path component must be exactly `probes` between slashes.
    expect(detectRunKind(["apis/r/myprobes/x.yaml"])).toBe("regular");
  });
});
