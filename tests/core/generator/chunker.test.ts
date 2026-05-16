import { describe, expect, test } from "bun:test";
import { collectTags, filterByTag, groupEndpointsByTag } from "../../../src/core/generator/chunker";
import type { EndpointInfo } from "../../../src/core/generator/types";

const ep = (tags: string[], path = "/x", method = "GET"): EndpointInfo => ({
  path,
  method,
  operationId: "x",
  tags,
  parameters: [],
  responses: {},
}) as unknown as EndpointInfo;

describe("filterByTag", () => {
  test("matches tag case-insensitively with trim", () => {
    const eps = [ep(["Audiences"]), ep(["Other"])];
    expect(filterByTag(eps, "audiences").length).toBe(1);
    expect(filterByTag(eps, "  AUDIENCES  ").length).toBe(1);
  });

  test("returns empty array when no tags match", () => {
    const eps = [ep(["Other"])];
    expect(filterByTag(eps, "Audiences")).toEqual([]);
  });

  test("TASK-239 — accepts comma-separated tags as union", () => {
    const eps = [
      ep(["Releases"], "/r"),
      ep(["Events"], "/e"),
      ep(["Alerts"], "/a"),
      ep(["Other"], "/o"),
    ];
    expect(filterByTag(eps, "Releases,Events").length).toBe(2);
    expect(filterByTag(eps, "releases, alerts").length).toBe(2);
    // Unknown tag in list is silently dropped; matching ones still pass.
    expect(filterByTag(eps, "Releases,Nope").length).toBe(1);
  });

  test("TASK-239 — comma list with 'untagged' includes both untagged + named", () => {
    const eps = [ep([], "/x"), ep(["Releases"], "/r"), ep(["Other"], "/o")];
    expect(filterByTag(eps, "untagged,Releases").length).toBe(2);
  });
});

describe("collectTags", () => {
  test("returns sorted unique tags from endpoints", () => {
    const eps = [ep(["B", "a"]), ep(["a", "C"])];
    expect(collectTags(eps)).toEqual(["a", "B", "C"]);
  });

  test("returns empty array when no tags", () => {
    expect(collectTags([])).toEqual([]);
  });
});

// TASK-36: tagless endpoints fall back to per-resource grouping (first
// non-templated path segment) so /audiences and /audiences/{id} land in
// the same `audiences` bucket, while /users/{id} stays separate.
describe("groupEndpointsByTag (TASK-36 tagless fallback)", () => {
  test("untagged endpoints group by first path segment", () => {
    const eps = [
      ep([], "/audiences", "GET"),
      ep([], "/audiences/{id}", "DELETE"),
      ep([], "/users/{id}", "GET"),
    ];
    const groups = groupEndpointsByTag(eps);
    expect(groups.get("audiences")?.length).toBe(2);
    expect(groups.get("users")?.length).toBe(1);
    expect(groups.has("untagged")).toBe(false);
  });

  test("tagged endpoints still use their first tag", () => {
    const eps = [ep(["Domains"], "/domains"), ep([], "/audiences/{id}")];
    const groups = groupEndpointsByTag(eps);
    expect(groups.get("Domains")?.length).toBe(1);
    expect(groups.get("audiences")?.length).toBe(1);
  });

  test("templated leading segment skipped — falls back to next segment", () => {
    const eps = [ep([], "/{tenant}/jobs/{id}")];
    const groups = groupEndpointsByTag(eps);
    expect(groups.get("jobs")?.length).toBe(1);
  });

  test("path is just `/` keeps `untagged` key", () => {
    const eps = [ep([], "/")];
    const groups = groupEndpointsByTag(eps);
    expect(groups.get("untagged")?.length).toBe(1);
  });
});
