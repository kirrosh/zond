# core/output — typed `--report` / `--output` / `--json` policy

`OutputSpec<Payload>` is the single source-of-truth for how a command
produces output. Per-command parsers (`checks run`, `probe security`,
`run`, …) are migrated in ARV-117/118/119 — this directory only ships
the infrastructure.

Closes the seven divergent-output bugs collected in
`strategy/lessons.md` §E (ARV-50, ARV-82, ARV-97, …) by replacing N
ad-hoc parsers with one resolver.

## Policy matrix

The runner (`runCommandWithOutput`) reads `--report`, `--output`, and
`--json` from the CLI layer and resolves them to a `ResolvedOutput`
decision according to this matrix:

| Input                                | Format         | Channel             | Notes |
| ------------------------------------ | -------------- | ------------------- | ----- |
| _(nothing)_                          | `defaultFormat`| from format policy  | bare invocation |
| `--report <fmt>`                     | `<fmt>` (or alias) | from format policy | unknown → error |
| `--json`                             | first format with `envelopeWrap: true` | from format policy | falls back to `defaultFormat` when no envelope-wrap format exists |
| `--output <path>`                    | unchanged      | `file` (path = resolved absolute) | `--output` always wins over `defaultChannel` |
| `--report sarif` (defaults to file)  | `sarif`        | `file` (`defaultFilename` if no `--output`) | ARV-5 default `zond-checks.sarif` |
| `--report ndjson` (defaults to stdout) | `ndjson`     | `stdout` | event stream — see ARV-10 |
| `--report ndjson --output <path>`    | `ndjson`       | `file`     | ARV-97 — explicit `--output` redirects the stream |
| `--json` + `--report <fmt>`          | —              | —          | mutually exclusive (throws `OutputSpecError`) |

Aliases (`spec.aliases`) let a single CLI flag value resolve to
another format — used by `checks run` so `--report ndjson` continues to
mean "the `--ndjson` streaming flag", matching skill-prompt
expectations (ARV-63).

## Building a spec

```ts
import type { OutputSpec } from "@/core/output";

interface ChecksPayload { findings: Finding[]; summary: Summary }

export const CHECKS_RUN_OUTPUT: OutputSpec<ChecksPayload> = {
  command: "checks run",
  defaultFormat: "json",
  formats: {
    json:   { defaultChannel: "stdout", envelopeWrap: true,  description: "JSON envelope" },
    sarif:  { defaultChannel: "file",   defaultFilename: "zond-checks.sarif" },
    ndjson: { defaultChannel: "stdout", description: "event stream — one JSON per line" },
  },
  aliases: {
    // `--report ndjson` is a friendly alias retained from skill prompts.
    ndjson: "ndjson",
  },
  render: (format, payload) => {
    if (format === "sarif")  return generateSarifReport(payload);
    if (format === "ndjson") return payload.findings.map(f => JSON.stringify(f)).join("\n");
    return JSON.stringify(payload, null, 2);
  },
};
```

The CLI handler then does:

```ts
const { resolved, exitCode } = await runCommandWithOutput(
  CHECKS_RUN_OUTPUT,
  cmd.opts<OutputOptions>(),
  async () => runChecks({ /* ... */ }),
);
process.exit(exitCode);
```

`resolveOutput()` can be called standalone (without rendering) when a
command wants to plug the resolution into its own streaming pipeline —
e.g. `checks run` opens an fd ahead of time and feeds events into it
incrementally; in that case the command consumes `resolved.path` and
`resolved.channel` and handles I/O itself.

## Why the format set is open

Each command owns its own format vocabulary. `run` ships
`json`/`junit`; `checks run` ships `json`/`sarif`/`ndjson`; `probe *`
ships `json` only. Declaring formats per-spec instead of in a global
union avoids a leaky enum and keeps `--help` accurate per command.

## Errors

`resolveOutput` throws `OutputSpecError` for policy violations
(`--json + --report`, unknown format, file-default without filename).
The CLI handler catches it and produces either `jsonError` or a human
`printError`, matching the rest of the codebase's input-error
behaviour (exit code 2).
