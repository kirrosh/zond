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

  // TASK-204: pin behavior on edge inputs so refactors don't silently change
  // semantics (especially the cases where applyTransform returns the directive
  // verbatim — those make {{var}} interpolation render the raw object).
  describe("edge cases", () => {
    test("get: out-of-bounds array index returns undefined", () => {
      expect(applyTransform({ get: [[10, 20], 5] })).toBeUndefined();
    });

    test("get: negative array index returns undefined (no JS-style wrap)", () => {
      // TS array[-1] is undefined natively — but pin it as the contract.
      expect(applyTransform({ get: [[10, 20], -1] })).toBeUndefined();
    });

    test("get: missing object key returns undefined", () => {
      expect(applyTransform({ get: [{ a: 1 }, "b"] })).toBeUndefined();
    });

    test("get: string index on array works via JS object semantics ('0' → arr[0])", () => {
      // Arrays are objects in JS, so string indices like "0" hit the
      // object-branch and resolve via arr["0"]. Pin this — it surprises
      // users but matches what the runtime does.
      expect(applyTransform({ get: [[1, 2], "0"] })).toBe(1);
    });

    test("get: numeric index on plain object returns undefined (mismatch)", () => {
      expect(applyTransform({ get: [{ a: 1 }, 0] })).toBeUndefined();
    });

    test("get: with <2 args returns directive verbatim", () => {
      expect(applyTransform({ get: [[1, 2]] })).toEqual({ get: [[1, 2]] });
    });

    test("length of number returns 0", () => {
      expect(applyTransform({ length: 42 })).toBe(0);
    });

    test("length of object returns 0 (no Object.keys fallback)", () => {
      expect(applyTransform({ length: { a: 1 } })).toBe(0);
    });

    test("append with <2 args returns directive verbatim", () => {
      expect(applyTransform({ append: [[1]] })).toEqual({ append: [[1]] });
    });

    test("append with non-array first arg starts from empty array", () => {
      expect(applyTransform({ append: [42, 1, 2] })).toEqual([1, 2]);
    });

    test("concat with non-array arg returns directive verbatim", () => {
      expect(applyTransform({ concat: "not-an-array" })).toEqual({ concat: "not-an-array" });
    });

    test("first of non-array returns undefined", () => {
      expect(applyTransform({ first: "string" })).toBeUndefined();
    });

    test("map_field: missing field on item produces undefined entry", () => {
      const items = [{ id: 1 }, { name: "x" }];
      expect(applyTransform({ map_field: [items, "id"] })).toEqual([1, undefined]);
    });

    test("map_field: non-object item produces undefined entry", () => {
      expect(applyTransform({ map_field: [["str", 42, null], "id"] })).toEqual([undefined, undefined, undefined]);
    });

    test("map_field: items not array returns directive verbatim", () => {
      expect(applyTransform({ map_field: ["not-array", "id"] })).toEqual({ map_field: ["not-array", "id"] });
    });

    test("array directive (not object) returned as-is", () => {
      expect(applyTransform([1, 2, 3])).toEqual([1, 2, 3]);
    });

    test("undefined returned as-is", () => {
      expect(applyTransform(undefined)).toBeUndefined();
    });
  });
});
