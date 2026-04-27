export interface FileMeta {
  generatedAt: string;
  zondVersion: string;
  suiteType: "smoke" | "crud" | "auth" | "sanity" | "unsafe";
  tag?: string;
  /** Normalized endpoint keys, e.g. ["GET /users", "POST /users/{*}"] */
  endpoints: string[];
}

export interface ZondMeta {
  /** Version of zond that last wrote this metadata */
  zondVersion: string;
  /** ISO timestamp of last sync/generate */
  lastSyncedAt: string;
  /** SHA-256 hex of spec content at time of last generation */
  specHash: string;
  /** Per-file metadata, keyed by filename (e.g. "smoke-users.yaml") */
  files: Record<string, FileMeta>;
}
