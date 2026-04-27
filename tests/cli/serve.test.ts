import { afterEach, describe, expect, test } from "bun:test";
import { serveCommand } from "../../src/cli/commands/serve.ts";

/**
 * These tests do real Bun.serve binds against 127.0.0.1 with --no-open and
 * tear down the server immediately after each case via stopAll().
 */

const stopAll: Array<() => void> = [];

afterEach(() => {
  for (const fn of stopAll.splice(0)) {
    try { fn(); } catch { /* ignore */ }
  }
});

function busyServer(port: number) {
  const srv = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("busy") });
  stopAll.push(() => srv.stop(true));
  return srv;
}

function pickFreePort(): number {
  // Pick a high port unlikely to clash with macOS ephemeral ranges or 8080 zone
  return 17000 + Math.floor(Math.random() * 1000);
}

describe("serveCommand auto-port", () => {
  test("uses the requested port when free", async () => {
    const port = pickFreePort();
    const code = await serveCommand({ port, host: "127.0.0.1" });
    expect(code).toBe(0);
    // serveCommand starts the real server; record stop hook
    // (we don't have a handle directly, but the test process will exit).
    // To avoid leaking a server across tests, immediately scan a known-busy
    // port to force teardown via subsequent assertions:
    stopAll.push(() => {
      // Best-effort: send a request and ignore — Bun.serve persists, but the
      // test process tears down on exit. For isolation between cases we use
      // distinct ports.
    });
  });

  test("falls through to next port when requested is busy", async () => {
    const port = pickFreePort();
    busyServer(port);

    // Capture stderr to confirm fallthrough message
    const orig = process.stderr.write.bind(process.stderr);
    let captured = "";
    (process.stderr as any).write = (chunk: any) => {
      captured += String(chunk);
      return true;
    };
    try {
      const code = await serveCommand({ port, host: "127.0.0.1" });
      expect(code).toBe(0);
      expect(captured).toContain(`port ${port} busy, using ${port + 1}`);
    } finally {
      (process.stderr as any).write = orig;
    }
  });

  test("returns exit 1 when the entire scan range is busy", async () => {
    const port = pickFreePort();
    // Occupy 11 consecutive ports (PORT_SCAN_LENGTH = 11)
    for (let p = port; p < port + 11; p++) busyServer(p);

    const orig = process.stderr.write.bind(process.stderr);
    let captured = "";
    (process.stderr as any).write = (chunk: any) => {
      captured += String(chunk);
      return true;
    };
    try {
      const code = await serveCommand({ port, host: "127.0.0.1" });
      expect(code).toBe(1);
      expect(captured).toMatch(/All ports \d+\.\.\d+ are in use/);
      expect(captured).toContain("--kill-existing");
    } finally {
      (process.stderr as any).write = orig;
    }
  });
});
