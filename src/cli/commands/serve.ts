import { startServer } from "../../web/server.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  watch?: boolean;
  open?: boolean;
}

/** Kill any existing process listening on the given port (Windows + Unix) */
async function killPortHolder(port: number): Promise<void> {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      // PowerShell: find PID on port, then kill it
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
      if (pids.length > 0) {
        // Give OS time to release the port
        await Bun.sleep(500);
      }
    } else {
      // Unix: lsof + kill
      const find = Bun.spawn(["lsof", "-ti", `:${port}`], {
        stdout: "pipe", stderr: "ignore",
      });
      const out = await new Response(find.stdout).text();
      const pids = out.trim().split(/\s+/).filter(s => /^\d+$/.test(s));
      for (const pid of pids) {
        Bun.spawn(["kill", "-9", pid], { stdout: "ignore", stderr: "ignore" });
      }
      if (pids.length > 0) {
        await Bun.sleep(300);
      }
    }
  } catch {
    // Best effort — if we can't kill, startServer will fail with port-in-use
  }
}

export async function serveCommand(options: ServeOptions): Promise<number> {
  const port = options.port ?? 8080;

  // Kill previous instance on the same port
  await killPortHolder(port);

  await startServer({
    port,
    host: options.host,
    dbPath: options.dbPath,
    dev: options.watch,
  });

  // Open browser if requested
  if (options.open) {
    const host = options.host === "0.0.0.0" || !options.host ? "localhost" : options.host;
    const url = `http://${host}:${port}`;
    try {
      const cmd = process.platform === "win32" ? ["cmd", "/c", "start", url]
        : process.platform === "darwin" ? ["open", url]
        : ["xdg-open", url];
      Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    } catch {
      // Best effort — if browser can't open, server still runs
    }
  }

  // Keep running — Bun.serve keeps the process alive
  return 0;
}
