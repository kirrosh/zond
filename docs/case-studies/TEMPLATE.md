# Case study template (m-28 format)

Fixed after runs #1 (GitHub, read-only) and #2 (Vercel, live). Every published
case study follows this structure — the differentiator vs a bug-bounty post is
the **honest asterisks** section (decision-8: no evidence → no high severity).

## Structure

```markdown
# Auditing <API>'s OpenAPI spec with a coding agent[, live]

> **<One grabby, honest lead stat.>** <2-3 sentences: what ran, what was
> found, what was NOT found. If zero security findings — say it in the lead.>

## What we did
- Target: <API>, official spec (<source>, <size/paths>).
- Tool: zond <version>, driven by a coding agent following the `/zond-scan` convention.
- Mode: <read-only | live> — <auth used, sandbox/throwaway story>.
- Scope: <N operations, depth cases, wall-clock>.

## What we found
<Calibrated findings only, strongest first. Rollups, not raw counts.
 End with the "zero of the scary stuff" paragraph — honest reporting
 means saying plainly what was NOT found.>

## The honest asterisks (why this is a *hygiene* tool, not a bug-bounty flex)
<Every caveat that a skeptical reader would find: honest-2xx and why it's
 capped, raw-vs-calibrated finding counts, INCONCLUSIVE probes reported as
 "couldn't test" not "clean", safety exclusions.>

## Why it matters for a small team
<"They have a spec-tooling budget you don't. If THEIR spec drifts this much,
 yours drifts more." + what the agent did that a script couldn't.>

## Numbers (run #N, <mode>)
| | |
|---|---|
| endpoints/operations tested | |
| honest-2xx | <with the cap explained inline> |
| server errors (5xx) | |
| security findings | |
| calibrated findings | <HIGH/MEDIUM/rollups — never the raw count> |
| wall-clock | |

---
*<canonical tagline, verbatim>* — [github.com/kirrosh/zond](https://github.com/kirrosh/zond)
```

## Rules

1. **Lead stat must be true without a footnote.** Intermittent 500 stays
   "intermittent" in the lead, not "we found a 500".
2. **Calibrated counts only.** Raw finding counts appear once, inside the
   asterisks section, as evidence of calibration — never as the headline.
3. **INCONCLUSIVE ≠ clean.** Probes that couldn't establish a baseline are
   reported as "couldn't test".
4. **Zero-findings are findings.** "No SSRF sinks in scope" is a sentence,
   not an omission.
5. **Canonical tagline verbatim in the footer** (ARV-398):
   > API hygiene scanner for small teams and their coding agents — test REST API endpoints against the OpenAPI spec, catch contract drift, track coverage.
