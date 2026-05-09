/**
 * `zond reference <topic>` — printable cheat-sheets for built-ins that aren't
 * surfaced anywhere else (TASK-267).
 *
 * Currently:
 *   reference random-helpers   # all `{{$random*}}` generators with examples
 *
 * Designed to be discoverable from `--help` AND scriptable: `--json` returns
 * an array of `{ name, example }` entries so the `zond-triage` / generator
 * skills can prompt with concrete values.
 */
import type { Command } from "commander";
import { GENERATORS } from "../../core/parser/variables.ts";
import { jsonOk, printJson } from "../json-envelope.ts";
import { globalJson } from "../resolve.ts";

interface HelperEntry {
  name: string;
  example: string;
  use_for: string;
}

const HELPER_NOTES: Record<string, string> = {
  "$uuid":          "RFC 4122 v4 — Idempotency-Key, opaque resource ids",
  "$timestamp":     "UNIX seconds — created_at, monotonic seeds",
  "$isoTimestamp":  "RFC 3339 timestamps",
  "$randomName":    "display names",
  "$randomEmail":   "unique e-mail body fields",
  "$randomInt":     "0–9999, small numeric ids",
  "$randomString":  "8 chars mixed-case + digits — opaque tokens",
  "$randomSlug":    "8 chars lowercase + digits — slug / handle / URL-safe ids",
  "$randomUrl":     "webhook / callback URL fields",
  "$randomFqdn":    "DNS / hostname inputs",
  "$randomDomain":  "alias of $randomFqdn",
  "$randomIpv4":    "RFC 1918 range — client_ip / source_ip",
  "$randomDate":    "calendar dates (YYYY-MM-DD)",
  "$randomIsoDate": "ISO-8601 datetime",
  "$nullByte":      "single space — placeholder for fields that reject empty strings",
};

function collectEntries(): HelperEntry[] {
  return Object.keys(GENERATORS)
    .sort()
    .map((name) => ({
      name,
      example: String(GENERATORS[name]!()),
      use_for: HELPER_NOTES[name] ?? "",
    }));
}

function renderTable(entries: HelperEntry[]): string {
  const nameWidth = Math.max(8, ...entries.map((e) => e.name.length));
  const exampleWidth = Math.max(10, ...entries.map((e) => e.example.length));
  const lines: string[] = [];
  lines.push(`${pad("Helper", nameWidth)}  ${pad("Example", exampleWidth)}  Use for`);
  lines.push(`${"-".repeat(nameWidth)}  ${"-".repeat(exampleWidth)}  ${"-".repeat(20)}`);
  for (const e of entries) {
    lines.push(`${pad(`{{${e.name}}}`, nameWidth + 4)}  ${pad(e.example, exampleWidth)}  ${e.use_for}`);
  }
  return lines.join("\n");
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function registerReference(program: Command): void {
  const ref = program
    .command("reference")
    .description("Printable references for built-ins (e.g. `random-helpers`).");

  ref
    .command("random-helpers")
    .description("List every `{{$random*}}` / `{{$uuid}}` / `{{$timestamp}}` helper, with a sample value and typical use. Pair `--json` for machine-readable output (TASK-267).")
    .action((opts: unknown, cmd: Command) => {
      const entries = collectEntries();
      if (globalJson(cmd)) {
        printJson(jsonOk("reference random-helpers", { helpers: entries }));
        return;
      }
      process.stdout.write(renderTable(entries) + "\n");
      process.stdout.write(
        "\nFor field-name → helper mapping used by `zond generate`, see docs/random-helpers.md.\n",
      );
      void opts;
    });
}
