import { tmpdir } from "os";
import { join } from "path";
import { existsSync, unlinkSync, renameSync, copyFileSync, chmodSync } from "fs";
import { VERSION } from "../index.ts";
import { isCompiledBinary } from "../runtime.ts";

export interface UpdateCommandOptions {
  force?: boolean;
}

export function detectTarget(): { target: string; archive: "tar.gz" | "zip" } {
  const platform = process.platform;
  const arch = process.arch;

  const os = platform === "win32" ? "win" : platform;
  const archSuffix = arch === "arm64" ? "arm64" : "x64";
  const target = `${os}-${archSuffix}`;
  const archive = platform === "win32" ? "zip" : ("tar.gz" as const);

  return { target, archive };
}

export function parseVersion(tag: string): string {
  return tag.replace(/^v/, "");
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export async function updateCommand(options: UpdateCommandOptions): Promise<number> {
  if (!isCompiledBinary()) {
    console.log("Running from source — use git pull to update.");
    return 0;
  }

  console.log("Checking for updates...");

  // Fetch latest release
  const res = await fetch("https://api.github.com/repos/kirrosh/apitool/releases/latest", {
    headers: { "User-Agent": "apitool-updater" },
  });

  if (!res.ok) {
    console.error(`Failed to check for updates: HTTP ${res.status}`);
    return 1;
  }

  const release = (await res.json()) as { tag_name: string };
  const latestVersion = parseVersion(release.tag_name);
  const currentVersion = VERSION;

  if (!options.force && compareVersions(currentVersion, latestVersion) >= 0) {
    console.log(`Already up to date (v${currentVersion}).`);
    return 0;
  }

  console.log(`Updating v${currentVersion} → v${latestVersion}...`);

  const { target, archive } = detectTarget();
  const assetName = `apitool-${target}.${archive}`;
  const downloadUrl = `https://github.com/kirrosh/apitool/releases/download/${release.tag_name}/${assetName}`;

  // Download artifact
  const dlRes = await fetch(downloadUrl);
  if (!dlRes.ok) {
    console.error(`Failed to download ${assetName}: HTTP ${dlRes.status}`);
    return 1;
  }

  const tempDir = tmpdir();
  const archivePath = join(tempDir, assetName);
  const archiveBytes = new Uint8Array(await dlRes.arrayBuffer());
  await Bun.write(archivePath, archiveBytes);

  // Extract
  const extractDir = join(tempDir, `apitool-update-${Date.now()}`);
  const mkdirResult = Bun.spawnSync(["mkdir", "-p", extractDir]);
  if (mkdirResult.exitCode !== 0) {
    // Fallback for Windows
    const { mkdirSync } = await import("fs");
    mkdirSync(extractDir, { recursive: true });
  }

  if (archive === "tar.gz") {
    const tar = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDir]);
    if (tar.exitCode !== 0) {
      console.error("Failed to extract archive.");
      return 1;
    }
  } else {
    // Windows zip — use tar (Windows 10+ includes bsdtar)
    const tar = Bun.spawnSync(["tar", "-xf", archivePath, "-C", extractDir]);
    if (tar.exitCode !== 0) {
      console.error("Failed to extract archive.");
      return 1;
    }
  }

  // Find extracted binary
  const binaryName = process.platform === "win32" ? "apitool.exe" : "apitool";
  const newBinary = join(extractDir, binaryName);

  if (!existsSync(newBinary)) {
    console.error(`Expected binary not found: ${newBinary}`);
    return 1;
  }

  // Replace current binary
  const currentBinary = process.execPath;

  if (process.platform === "win32") {
    // Windows: can't overwrite running exe — rename current to .old, copy new
    const oldPath = currentBinary + ".old";
    try {
      if (existsSync(oldPath)) unlinkSync(oldPath);
    } catch { /* ignore */ }
    renameSync(currentBinary, oldPath);
    copyFileSync(newBinary, currentBinary);
  } else {
    // Unix: rename new over current (atomic on same filesystem, but we copy across)
    unlinkSync(currentBinary);
    copyFileSync(newBinary, currentBinary);
    chmodSync(currentBinary, 0o755);
  }

  // Cleanup
  try {
    unlinkSync(archivePath);
    unlinkSync(newBinary);
  } catch { /* best effort */ }

  console.log(`Updated to v${latestVersion}.`);
  return 0;
}
