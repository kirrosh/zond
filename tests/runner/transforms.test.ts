import { describe, test, expect } from "bun:test";
import { applyTransform } from "../../src/core/runner/transforms.ts";

describe("applyTransform", () => {
  test("concat merges arrays", () => {
    expect(applyTransform({ concat: [[1, 2], [3, 4]] })).toEqual([1, 2, 3, 4]);
  });

  test("concat with non-array items pushes them", () => {
    expect(applyTransform({ concat: [[1, 2], "three"] })).toEqual([1, 2, "three"]);
  });

  test("append adds items to array", () => {
    expect(applyTransform({ append: [[1, 2], 3] })).toEqual([1, 2, 3]);
  });

  test("append with multiple items", () => {
    expect(applyTransform({ append: [[1], 2, 3] })).toEqual([1, 2, 3]);
  });

  test("length of array", () => {
    expect(applyTransform({ length: [1, 2, 3] })).toBe(3);
  });

  test("length of string", () => {
    expect(applyTransform({ length: "hello" })).toBe(5);
  });

  test("get array element by index", () => {
    expect(applyTransform({ get: [[10, 20, 30], 1] })).toBe(20);
  });

  test("get object field by key", () => {
    expect(applyTransform({ get: [{ a: 1, b: 2 }, "b"] })).toBe(2);
  });

  test("first returns first element", () => {
    expect(applyTransform({ first: [10, 20, 30] })).toBe(10);
  });

  test("first of empty array returns undefined", () => {
    expect(applyTransform({ first: [] })).toBeUndefined();
  });

  test("map_field extracts field from each item", () => {
    const items = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    expect(applyTransform({ map_field: [items, "id"] })).toEqual([1, 2]);
  });

  test("plain value is returned as-is", () => {
    expect(applyTransform("hello")).toBe("hello");
    expect(applyTransform(42)).toBe(42);
    expect(applyTransform(null)).toBe(null);
  });

  test("object without known directive is returned as-is", () => {
    expect(applyTransform({ unknown: [1, 2] })).toEqual({ unknown: [1, 2] });
  });

  test("object with multiple keys is returned as-is", () => {
    expect(applyTransform({ concat: [[1]], length: [1] })).toEqual({ concat: [[1]], length: [1] });
  });
});
