#!/usr/bin/env bun
/**
 * Post-build adhoc codesign for the compiled zond binary on macOS.
 *
 * Bun's `--compile` produces an unsigned Mach-O executable. On macOS 14+ the
 * Gatekeeper subsystem refuses to load unsigned binaries on first run with
 * SIGKILL — the failure surfaces as `kill: 9` or `code or signature have been
 * modified`, which is visually indistinguishable from any other crash and
 * routinely costs developers ~5 minutes of confusion after every rebuild.
 *
 * `codesign --force --sign -` applies an adhoc signature (no Developer ID
 * needed) which is enough to satisfy Gatekeeper for local execution. CI
 * release builds should still use a real Developer ID — see docs/ci.md.
 *
 * On non-darwin platforms this script is a no-op.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const BINARY = process.argv[2] ?? "./zond";

if (process.platform !== "darwin") {
  process.exit(0);
}

if (!existsSync(BINARY) || !statSync(BINARY).isFile()) {
  console.error(`[codesign] skipped: ${BINARY} not found or not a file`);
  process.exit(0);
}

const which = spawnSync("which", ["codesign"], { stdio: ["ignore", "pipe", "ignore"] });
if (which.status !== 0) {
  console.warn(
    "[codesign] skipped: `codesign` not in PATH. macOS Gatekeeper may SIGKILL the binary on first run.",
  );
  process.exit(0);
}

// Strip xattrs first — `com.apple.provenance` (added on download/cp) and
// `com.apple.quarantine` invalidate the signature we're about to apply.
spawnSync("xattr", ["-c", BINARY], { stdio: "ignore" });

const result = spawnSync("codesign", ["--force", "--sign", "-", BINARY], {
  stdio: "inherit",
});

if (result.status !== 0) {
  console.warn(
    `[codesign] adhoc signing failed (exit ${result.status}). The binary may be SIGKILL'd by Gatekeeper.`,
  );
  // Do not fail the build — the binary itself is correct, signing is best-effort.
  process.exit(0);
}
