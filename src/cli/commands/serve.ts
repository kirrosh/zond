import { startServer } from "../../web/server.ts";
import { printError } from "../output.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  watch?: boolean;
  open?: boolean;
  /** When true, kill any existing process holding `port` before binding (DANGEROUS). */
  killExisting?: boolean;
}

/** Range scanned when auto-picking a free port (only when --port is not set). */
const PORT_SCAN_LENGTH = 11; // 8080..8090 inclusive

/** Kill any existing process listening on the given port (Windows + Unix). */
async function killPortHolder(port: number): Promise<void> {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      const find = Bun.spawn(["powershell", "-NoProfile", "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess`], {
        stdout: "pipe", stderr: "ignore",
      });
      const out = await new Response(find.stdout).text();
      const pids = [...new Set(out.trim().split(/\s+/).filter(s => /^\d+$/.test(s) && s !== "0"))];
      for (const pid of pids) {
        Bun.spawn(["powershell", "-NoProfile", "-Command",
          `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], {
          stdout: "ignore", stderr: "ignore",
        });
      }
      if (pids.length > 0) await Bun.sleep(500);
    } else {
      const find = Bun.spawn(["lsof", "-ti", `:${port}`], {
        stdout: "pipe", stderr: "ignore",
      });
      const out = await new Response(find.stdout).text();
      const pids = out.trim().split(/\s+/).filter(s => /^\d+$/.test(s));
      for (const pid of pids) {
        Bun.spawn(["kill", "-9", pid], { stdout: "ignore", stderr: "ignore" });
      }
      if (pids.length > 0) await Bun.sleep(300);
    }
  } catch {
    // Best effort — if we can't kill, the bind below will fail with port-in-use
  }
}

/** Returns true if `port` is free on `host` (best-effort: tries to bind & immediately stops). */
async function isPortFree(port: number, host: string): Promise<boolean> {
  try {
    const srv = Bun.serve({ port, hostname: host, fetch: () => new Response() });
    srv.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Scans `[start, start+count)` and returns the first free port, or null. */
async function pickAvailablePort(start: number, count: number, host: string): Promise<number | null> {
  for (let p = start; p < start + count; p++) {
    if (await isPortFree(p, host)) return p;
  }
  return null;
}

export async function serveCommand(options: ServeOptions): Promise<number> {
  const requested = options.port ?? 8080;
  const host = options.host ?? "0.0.0.0";

  let port: number;
  if (options.killExisting) {
    await killPortHolder(requested);
    port = requested;
  } else {
    const picked = await pickAvailablePort(requested, PORT_SCAN_LENGTH, host);
    if (picked === null) {
      printError(
        `All ports ${requested}..${requested + PORT_SCAN_LENGTH - 1} are in use. ` +
        `Use --port <n> to pick another, or --kill-existing to free :${requested}.`,
      );
      return 1;
    }
    if (picked !== requested) {
      process.stderr.write(`[zond] port ${requested} busy, using ${picked}\n`);
    }
    port = picked;
  }

  await startServer({
    port,
    host: options.host,
    dbPath: options.dbPath,
    dev: options.watch,
  });

  if (options.open) {
    const openHost = host === "0.0.0.0" ? "localhost" : host;
    const url = `http://${openHost}:${port}`;
    try {
      const cmd = process.platform === "win32" ? ["cmd", "/c", "start", url]
        : process.platform === "darwin" ? ["open", url]
        : ["xdg-open", url];
      Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    } catch {
      // Best effort
    }
  }

  return 0;
}
