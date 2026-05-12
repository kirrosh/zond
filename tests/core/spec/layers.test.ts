/**
 * ARV-122: SpecLayer / composeSpec unit tests.
 *
 * Covers merge-policy semantics (override / preserve / append),
 * precedence-driven ordering, async loaders, the provenance map,
 * and the duplicate-id guard. Real-fs integration (.api-resources.yaml
 * ↔ .api-resources.local.yaml) lives in tests/cli/resource-extensions.test.ts
 * — keeping this test fs-free makes failure messages mention the
 * merge engine instead of YAML parsing.
 */
import { describe, test, expect } from "bun:test";
import {
  composeSpec,
  type SpecLayer,
} from "../../../src/core/spec/layers.ts";

interface Entry {
  name: string;
  value: string;
}

function fakeLayer(
  id: string,
  precedence: number,
  mergePolicy: "override" | "preserve" | "append",
  entries: Entry[],
): SpecLayer<Entry> {
  return {
    id,
    precedence,
    scope: "resources",
    mergePolicy,
    load: () => entries,
  };
}

describe("composeSpec (ARV-122)", () => {
  test("override: higher precedence wins on key collision", async () => {
    const composed = await composeSpec(
      [
        fakeLayer("upstream", 10, "override", [
          { name: "users", value: "from-upstream" },
          { name: "posts", value: "from-upstream" },
        ]),
        fakeLayer("extension", 20, "override", [
          { name: "users", value: "from-extension" },
        ]),
      ],
      (e) => e.name,
    );

    const byName = new Map(composed.entries.map((e) => [e.name, e.value]));
    expect(byName.get("users")).toBe("from-extension");
    expect(byName.get("posts")).toBe("from-upstream");
    expect(composed.provenance.get("users")).toBe("extension");
    expect(composed.provenance.get("posts")).toBe("upstream");
  });

  test("preserve: lower precedence keeps the key when higher arrives", async () => {
    // The preserve policy applies to the layer that arrives later
    // (higher precedence) — it skips if a key is already owned.
    const composed = await composeSpec(
      [
        fakeLayer("base", 10, "override", [{ name: "users", value: "base" }]),
        fakeLayer("default-fill", 20, "preserve", [
          { name: "users", value: "default" },
          { name: "groups", value: "default" },
        ]),
      ],
      (e) => e.name,
    );
    expect(composed.provenance.get("users")).toBe("base");
    expect(composed.provenance.get("groups")).toBe("default-fill");
  });

  test("append: same key kept multiple times with synthetic suffix", async () => {
    const composed = await composeSpec(
      [
        fakeLayer("a", 10, "append", [{ name: "x", value: "1" }]),
        fakeLayer("b", 20, "append", [{ name: "x", value: "2" }]),
      ],
      (e) => e.name,
    );
    expect(composed.entries).toHaveLength(2);
    const layerIds = Array.from(composed.provenance.values()).sort();
    expect(layerIds).toEqual(["a", "b"]);
  });

  test("precedence drives apply order regardless of input array order", async () => {
    const composed = await composeSpec(
      [
        fakeLayer("hi", 99, "override", [{ name: "k", value: "hi" }]),
        fakeLayer("lo", 1, "override", [{ name: "k", value: "lo" }]),
      ],
      (e) => e.name,
    );
    // Both override, but "hi" has higher precedence → wins.
    expect(composed.entries[0]!.value).toBe("hi");
    expect(composed.provenance.get("k")).toBe("hi");
  });

  test("async loaders are awaited in precedence order", async () => {
    const calls: string[] = [];
    const composed = await composeSpec(
      [
        {
          id: "slow",
          precedence: 10,
          scope: "resources",
          mergePolicy: "override",
          load: async () => {
            await new Promise((r) => setTimeout(r, 5));
            calls.push("slow");
            return [{ name: "k", value: "slow" }];
          },
        },
        {
          id: "fast",
          precedence: 20,
          scope: "resources",
          mergePolicy: "override",
          load: () => {
            calls.push("fast");
            return [{ name: "k", value: "fast" }];
          },
        },
      ],
      (e) => e.name,
    );
    // Ordering of *resolution* must follow precedence, not which
    // promise settles first — otherwise provenance is racy.
    expect(calls).toEqual(["slow", "fast"]);
    expect(composed.provenance.get("k")).toBe("fast");
  });

  test("duplicate layer ids throw", async () => {
    await expect(
      composeSpec(
        [
          fakeLayer("dup", 10, "override", []),
          fakeLayer("dup", 20, "override", []),
        ],
        (e) => e.name,
      ),
    ).rejects.toThrow(/duplicate layer id "dup"/);
  });

  test("empty layer list yields empty composed spec", async () => {
    const composed = await composeSpec<Entry>([], (e) => e.name);
    expect(composed.entries).toEqual([]);
    expect(composed.provenance.size).toBe(0);
  });
});
