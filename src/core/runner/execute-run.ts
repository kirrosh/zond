/**
 * Heuristic for "auth-shaped" endpoint paths used by --safe mode and run-time
 * env-symptom diagnostics. The historical `executeRun` orchestrator that lived
 * in this file was superseded by `src/cli/commands/run.ts`; only this regex
 * survives.
 */
export const AUTH_PATH_RE = /\/(auth|login|signin|token|oauth)\b/i;
