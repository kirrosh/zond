import { VERSION } from "../version.ts";
import { isCompiledBinary } from "../runtime.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface UpdateOptions {
  json?: boolean;
  check?: boolean;
}

const REPO = "kirrosh/zond";
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

interface GitHubRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

function getTarget(): { target: string; ext: string } | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux" && arch === "x64") return { target: "linux-x64", ext: "tar.gz" };
  if (platform === "darwin" && arch === "arm64") return { target: "darwin-arm64", ext: "tar.gz" };
  if (platform === "win32" && arch === "x64") return { target: "win-x64", ext: "zip" };
  return null;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const resp = await fetch(GITHUB_API, {
    headers: { "User-Agent": `zond/${VERSION}` },
  });
  if (!resp.ok) {
    throw new Error(`GitHub API returned ${resp.status}: ${resp.statusText}`);
  }
  return resp.json() as Promise<GitHubRelease>;
}

export async function updateCommand(options: UpdateOptions): Promise<number> {
  try {
    if (!isCompiledBinary()) {
      const msg = "Self-update is only available for standalone binaries. Install binary: curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh";
      if (options.json) {
        printJson(jsonOk("update", { action: "skip", reason: "not-standalone", installHint: "curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh" }, [msg]));
      } else {
        printWarning(msg);
      }
      return 3;
    }

    const target = getTarget();
    if (!target) {
      const msg = `Unsupported platform: ${process.platform}-${process.arch}`;
      if (options.json) {
        printJson(jsonError("update", [msg]));
      } else {
        printError(msg);
      }
      return 2;
    }

    const release = await fetchLatestRelease();
    const latest = release.tag_name.replace(/^v/, "");

    if (latest === VERSION) {
      const msg = `Already up to date (${VERSION})`;
      if (options.json) {
        printJson(jsonOk("update", { action: "none", currentVersion: VERSION, latestVersion: latest }));
      } else {
        console.log(msg);
      }
      return 0;
    }

    if (options.check) {
      const msg = `Update available: ${VERSION} → ${latest}`;
      if (options.json) {
        printJson(jsonOk("update", { action: "available", currentVersion: VERSION, latestVersion: latest }));
      } else {
        console.log(msg);
      }
      return 0;
    }

    // Find the right asset
    const assetName = `zond-${target.target}.${target.ext}`;
    const asset = release.assets.find(a => a.name === assetName);
    if (!asset) {
      const msg = `Binary not found for ${target.target} in release ${release.tag_name}`;
      if (options.json) {
        printJson(jsonError("update", [msg]));
      } else {
        printError(msg);
      }
      return 2;
    }

    console.log(`Updating zond ${VERSION} → ${latest}...`);
    console.log(`Downloading ${assetName}...`);

    // Download the archive
    const resp = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": `zond/${VERSION}` },
    });
    if (!resp.ok) {
      throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
    }
    const archiveData = new Uint8Array(await resp.arrayBuffer());

    const currentBinary = process.execPath;
    const { join, dirname } = await import("path");
    const tmpDir = join(dirname(currentBinary), `.zond-update-${Date.now()}`);
    const { mkdir, rm, rename, chmod } = await import("fs/promises");
    await mkdir(tmpDir, { recursive: true });

    try {
      const archivePath = join(tmpDir, assetName);
      await Bun.write(archivePath, archiveData);

      // Extract
      if (target.ext === "tar.gz") {
        const proc = Bun.spawn(["tar", "-xzf", archivePath, "-C", tmpDir]);
        const exitCode = await proc.exited;
        if (exitCode !== 0) throw new Error(`tar extraction failed (exit ${exitCode})`);
      } else {
        // Windows zip
        const proc = Bun.spawn([
          "powershell", "-NoProfile", "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force`,
        ]);
        const exitCode = await proc.exited;
        if (exitCode !== 0) throw new Error(`Zip extraction failed (exit ${exitCode})`);
      }

      // Find the extracted binary
      const binaryName = process.platform === "win32" ? "zond.exe" : "zond";
      const newBinary = join(tmpDir, binaryName);
      const file = Bun.file(newBinary);
      if (!await file.exists()) {
        throw new Error(`Binary '${binaryName}' not found in archive`);
      }

      // Replace current binary
      try {
        if (process.platform === "win32") {
          // Windows: rename current to .old, move new, clean up
          const oldBinary = currentBinary + ".old";
          try { await rm(oldBinary, { force: true }); } catch {}
          await rename(currentBinary, oldBinary);
          await rename(newBinary, currentBinary);
          try { await rm(oldBinary, { force: true }); } catch {}
        } else {
          await rename(newBinary, currentBinary);
          await chmod(currentBinary, 0o755);
        }
      } catch (replaceErr: any) {
        if (replaceErr?.code === "EACCES" || replaceErr?.code === "EPERM") {
          const hint = process.platform === "win32"
            ? `Permission denied. Run the terminal as Administrator.`
            : `Permission denied writing to ${currentBinary}. Run: sudo zond update`;
          if (options.json) {
            printJson(jsonError("update", [hint]));
          } else {
            printError(hint);
          }
          return 2;
        }
        throw replaceErr;
      }

      if (options.json) {
        printJson(jsonOk("update", { action: "updated", previousVersion: VERSION, newVersion: latest }));
      } else {
        printSuccess(`Updated zond ${VERSION} → ${latest}`);
      }
      return 0;
    } finally {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("update", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
