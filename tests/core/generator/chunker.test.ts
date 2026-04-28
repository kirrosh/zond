import { describe, expect, test } from "bun:test";
import { collectTags, filterByTag } from "../../../src/core/generator/chunker";
import type { EndpointInfo } from "../../../src/core/generator/types";

const ep = (tags: string[]): EndpointInfo => ({
  path: "/x",
  method: "GET",
  operationId: "getX",
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
