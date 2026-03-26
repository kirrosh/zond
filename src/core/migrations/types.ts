import type { RawSuite } from "../generator/serializer.ts";

export interface Migration {
  /** Version this migration targets (applied when upgrading TO this version) */
  toVersion: string;
  /** Human-readable description of what this migration does */
  description: string;
  /**
   * Transform a RawSuite for this migration.
   * Return null if no changes are needed for this suite (file won't be rewritten).
   */
  transformSuite(suite: RawSuite): RawSuite | null;
}

export interface MigrationResult {
  file: string;
  changed: boolean;
  appliedMigrations: string[];
  error?: string;
}
