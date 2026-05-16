/**
 * Generic key-value settings table. The two helpers are currently
 * unused by any caller — kept as the canonical access point so future
 * features (UI prefs, ephemeral run state) can use them without
 * re-rolling SQL. See TASK-179 / TASK-187.
 */
import { getDb } from "../schema.ts";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional: see file docstring
function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional: see file docstring
function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ($key, $value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run({ $key: key, $value: value });
}

// Reference the helpers so module-private code keeps tsc/knip happy
// while we leave the slot reserved for future settings consumers.
void getSetting;
void setSetting;
