import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";

export function tmpDb(prefix: string = "zond-test"): string {
  return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

export function unlinkDb(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* best-effort: WAL sidecars may not exist; Windows holds locks */ }
  }
}
