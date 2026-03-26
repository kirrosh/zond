import type { Migration } from "../types.ts";
import type { RawSuite } from "../../generator/serializer.ts";

/**
 * Example placeholder migration for zond v0.17.0.
 * Replace this with a real transformation when v0.17.0 introduces breaking YAML changes.
 *
 * Pattern to follow for real migrations:
 *   1. Check if suite needs changes (return null if not)
 *   2. Return a new RawSuite with the transformation applied
 *   3. Keep transformations idempotent (safe to run twice)
 */
export const migrationV0_17_0: Migration = {
  toVersion: "0.17.0",
  description: "Placeholder migration for zond v0.17.0 format changes",
  transformSuite(_suite: RawSuite): RawSuite | null {
    // No-op: return null to signal no changes needed
    return null;
  },
};
