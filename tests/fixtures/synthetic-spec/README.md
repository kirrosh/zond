# synthetic-spec — minimal API fixture for skill regression

A tiny but valid `apis/<name>/` snapshot used by
`tests/contracts/skill-examples.test.ts` (ARV-121). The regression test
parses every `zond …` snippet out of `src/cli/commands/init/templates/skills/*.md`
and validates the form against the real `buildProgram()` command tree.

The test is **structural** — it does not execute commands against a
live API. The fixture only exists so future tests (or a deeper variant
of this one) can point `--spec` / `--api` at a real on-disk artefact
without inventing one inline.

Adding a known-broken example (say `zond run --json`) to any
`skills/*.md` should make this test fail. See AC#4 in
`backlog/tasks/arv-121*.md`.
