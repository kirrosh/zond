/**
 * ARV-116 (m-19): typed declaration of every `--report` / `--output` /
 * `--json` combination a command supports.
 *
 * Background. Lesson §E of strategy/lessons.md collects seven separate
 * bug reports about output-flag plumbing:
 *   - ARV-97 — `--report ndjson --output <path>` silently dropped events;
 *   - ARV-50 — probe `--dry-run` JSON shape diverged from `--report json`;
 *   - ARV-82 — `db runs --json` envelope `data` field shape disagreed
 *     with sibling commands;
 *   - …and four more along the same lines.
 *
 * Root cause: each command has its own ad-hoc flag parser. Some treat
 * "ndjson" as an alias for `--ndjson`, some don't. Some honour
 * `--output` for SARIF only, some for every format. Some wrap in a JSON
 * envelope, some emit a raw stream. There is no single place to read
 * "what does `command X` produce when I pass `--report Y --output Z`".
 *
 * This module gives that single place. A command declares an
 * `OutputSpec<Payload>` once — listing the formats it supports, each
 * format's default channel (stdout vs file), each format's default
 * filename, and whether the format wraps in the standard `--json`
 * envelope. A runner helper (`runCommandWithOutput`) consumes the spec
 * plus the CLI flags and resolves them to a single `ResolvedOutput`
 * decision, with consistent mutual-exclusion enforcement.
 *
 * The spec is the source-of-truth for ARV-120's build-time check:
 * every `--json` command must declare an `OutputSpec` with an
 * `envelopeWrap: true` entry, so the published schema and the runtime
 * output cannot drift.
 *
 * This task only ships the infrastructure. Per-command migration
 * (`run`, `checks`, `probe*`) lands in ARV-117/118/119.
 */

/** Where a rendered payload lands. */
export type OutputChannel = "stdout" | "file";

/** A format name — `sarif` / `ndjson` / `json` / `junit` etc. The set is
 *  open: each command declares its own. */
export type OutputFormat = string;

/** Per-format policy: where the format writes by default, what filename
 *  to use when it writes to a file, and whether the payload is wrapped
 *  in the standard `{ ok, command, data, ... }` envelope. */
export interface FormatPolicy {
  /** Default destination when neither `--output` nor channel-overriding
   *  flags are present. SARIF defaults to file (`zond-checks.sarif`);
   *  NDJSON defaults to stdout (one event per line for piping); JSON
   *  envelopes default to stdout. */
  defaultChannel: OutputChannel;
  /** Default filename when `defaultChannel === "file"`. Relative paths
   *  are resolved against cwd by the runner. Ignored when
   *  `defaultChannel === "stdout"` — the user has to opt in to a file
   *  via `--output`. */
  defaultFilename?: string;
  /** True for formats that should be wrapped in the shared envelope
   *  (`jsonOk` / `jsonError` from `cli/json-envelope.ts`). Streaming
   *  formats (NDJSON) and bespoke serialisations (SARIF, JUnit) are
   *  not envelope-wrapped — they have their own contracts. */
  envelopeWrap?: boolean;
  /** ARV-120: for `envelopeWrap` formats — basename of the JSON schema
   *  under `docs/json-schema/` that describes the envelope's `data`
   *  field. The build-time coverage test asserts the file exists, so
   *  a renamed/deleted schema fails CI together with the spec. */
  envelopeSchemaFile?: string;
  /** Optional human description, surfaced by `--help` generators and
   *  the README table. */
  description?: string;
}

export interface OutputSpec<Payload = unknown> {
  /** Command name — propagated into the JSON envelope's `command` field
   *  and used by error messages. */
  command: string;
  /** Supported formats keyed by name. Unknown formats fall through to
   *  an error (no silent acceptance, see ARV-97). */
  formats: Record<OutputFormat, FormatPolicy>;
  /** Default format when neither `--report` nor `--json` is set. */
  defaultFormat: OutputFormat;
  /** Optional alias map: `{ ndjson: 'ndjson' }` lets `--report ndjson`
   *  fold into the `--ndjson` flag (ARV-63 alias, retained because
   *  skill prompts ship it). Keys are flag values seen on the CLI;
   *  values are the resolved format name. */
  aliases?: Record<string, OutputFormat>;
  /** Optional pre-validated render hook. Called by the runner once
   *  the format is resolved. Receives the payload plus the resolved
   *  format and returns the serialized output. */
  render?: (format: OutputFormat, payload: Payload) => string;
  /** Optional exit-code policy. Receives the payload after a
   *  successful run; returns the process exit code (0 by default). */
  exitCodePolicy?: (payload: Payload) => number;
}

/** Decision the runner makes after applying the spec to CLI flags. */
export interface ResolvedOutput {
  /** Resolved format name (always one of `spec.formats`). */
  format: OutputFormat;
  /** Resolved destination. */
  channel: OutputChannel;
  /** Filesystem path when `channel === "file"`. Absolute path expected
   *  by callers — the runner resolves it against cwd. */
  path?: string;
  /** Whether the runner should wrap the payload in the standard
   *  envelope before writing. Mirrors `FormatPolicy.envelopeWrap`. */
  envelopeWrap: boolean;
}

/** Inputs the runner reads from the CLI layer. Names mirror commander
 *  options so a command can pass `cmd.opts<OutputOptions>()` directly. */
export interface OutputOptions {
  /** `--report <format>`. */
  report?: string;
  /** `--output <path>`. */
  output?: string;
  /** `--json`. */
  json?: boolean;
}

/** Thrown by `resolveOutput` when the user-supplied flags violate the
 *  spec's policy (unknown format, mutually exclusive flags, …). The
 *  CLI layer catches this and emits the standard `jsonError` or
 *  human `printError`. */
export class OutputSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputSpecError";
  }
}
