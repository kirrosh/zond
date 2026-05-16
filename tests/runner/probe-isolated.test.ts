import { describe, test, expect } from "bun:test";
import { pathTouchesSeededVar } from "../../src/core/probe/shared.ts";

// TASK-264: guard helper used by `--isolated` to skip mutation probes on
// endpoints whose path-params resolve from `.env.yaml`. The matcher must be
// permissive on naming variations (`audience_id` vs `audience-slug` vs
// `audience`) so spec drift doesn't leak fixtures.

describe("pathTouchesSeededVar (TASK-264)", () => {
  test("matches by exact var name", () => {
    expect(pathTouchesSeededVar("/teams/{team_id}", { team_id: "acme" })).toBe(true);
  });

  test("ignores empty / whitespace fixture values", () => {
    expect(pathTouchesSeededVar("/teams/{team_id}", { team_id: "" })).toBe(false);
    expect(pathTouchesSeededVar("/teams/{team_id}", { team_id: "   " })).toBe(false);
  });

  test("normalizes underscores/dashes — `audience_id` matches `{audience-id}`", () => {
    expect(pathTouchesSeededVar("/audiences/{audience-id}", { audience_id: "x" })).toBe(true);
  });

  test("strips _id / _slug / _or_slug suffix when comparing", () => {
    // var named `audience` covers `{audience_id}` / `{audience_or_slug}`.
    expect(pathTouchesSeededVar("/a/{audience_id}", { audience: "x" })).toBe(true);
    expect(pathTouchesSeededVar("/a/{audience_or_slug}", { audience: "x" })).toBe(true);
  });

  test("returns false when no path-param matches any seeded var", () => {
    expect(pathTouchesSeededVar("/contacts/{contact_id}", { team_id: "x" })).toBe(false);
  });

  test("returns false on paths without placeholders", () => {
    expect(pathTouchesSeededVar("/teams", { team_id: "x" })).toBe(false);
  });
});
