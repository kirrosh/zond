import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { SCHEMAS } from "../../src/cli/json-schemas.ts";

// TASK-295: published JSON Schemas under docs/json-schema/ are generated
// from the zod sources. These tests guarantee the two never drift —
// re-run `bun run schemas` if a schema-shape change breaks one.

const OUT_DIR = join(import.meta.dir, "..", "..", "docs", "json-schema");

describe("TASK-295: docs/json-schema is in sync with zod source", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    test(`${name}.schema.json matches z.toJSONSchema()`, () => {
      const path = join(OUT_DIR, `${name}.schema.json`);
      expect(existsSync(path)).toBe(true);
      const onDisk = readFileSync(path, "utf-8");
      const expected = JSON.stringify(z.toJSONSchema(schema), null, 2) + "\n";
      expect(onDisk).toBe(expected);
    });
  }

  test("envelope schema validates a real --json envelope", () => {
    const sample = {
      ok: false,
      command: "lint-spec",
      data: null,
      warnings: [],
      errors: [{ code: "spec_load_failure" as const, message: "boom" }],
      exit_code: 2,
    };
    expect(() => SCHEMAS.envelope.parse(sample)).not.toThrow();
  });

  test("error schema rejects an unknown code", () => {
    const bad = { code: "totally_made_up", message: "x" };
    const result = SCHEMAS.error.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
