import { afterEach, describe, expect, test } from "bun:test";
import { serveCommand, pickAvailablePort } from "../../src/cli/commands/serve.ts";

/**
 * These tests bind real Bun.serve sockets against 127.0.0.1 with --no-open.
 * Every started server (test- or busyServer-owned) lands in `stopAll` and is
 * torn down in afterEach via server.stop(true) — so reruns don't trip on
 * `address in use`.
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

/** Find a port that is currently free + 11 free neighbours (matches the scan
 *  range used by serveCommand). Retries within a high port range to avoid
 *  flakes from randomly hitting an already-bound port. */
async function pickFreePortWindow(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = 17000 + Math.floor(Math.random() * 1000);
    const found = await pickAvailablePort(start, 12, "127.0.0.1");
    if (found !== null && found === start) return start;
  }
  throw new Error("could not find a free 12-port window in 17000-18000");
}

describe("serveCommand auto-port", () => {
  test("uses the requested port when free", async () => {
    const port = await pickFreePortWindow();
    const result = await serveCommand({ port, host: "127.0.0.1" });
    if (result.server) stopAll.push(() => result.server!.stop(true));
    expect(result.code).toBe(0);
    expect(result.server).toBeDefined();
    expect(result.server!.port).toBe(port);
  });

  test("falls through to next port when requested is busy", async () => {
    const port = await pickFreePortWindow();
    busyServer(port);

    const orig = process.stderr.write.bind(process.stderr);
    let captured = "";
    (process.stderr as any).write = (chunk: any) => {
      captured += String(chunk);
      return true;
    };
    try {
      const result = await serveCommand({ port, host: "127.0.0.1" });
      if (result.server) stopAll.push(() => result.server!.stop(true));
      expect(result.code).toBe(0);
      expect(captured).toContain(`port ${port} busy, using ${port + 1}`);
      expect(result.server!.port).toBe(port + 1);
    } finally {
      (process.stderr as any).write = orig;
    }
  });

  test("returns exit 1 when the entire scan range is busy", async () => {
    const port = await pickFreePortWindow();
    // Occupy 11 consecutive ports (PORT_SCAN_LENGTH = 11)
    for (let p = port; p < port + 11; p++) busyServer(p);

    const orig = process.stderr.write.bind(process.stderr);
    let captured = "";
    (process.stderr as any).write = (chunk: any) => {
      captured += String(chunk);
      return true;
    };
    try {
      const result = await serveCommand({ port, host: "127.0.0.1" });
      if (result.server) stopAll.push(() => result.server!.stop(true));
      expect(result.code).toBe(1);
      expect(result.server).toBeUndefined();
      expect(captured).toMatch(/All ports \d+\.\.\d+ are in use/);
      expect(captured).toContain("--kill-existing");
    } finally {
      (process.stderr as any).write = orig;
    }
  });
});
