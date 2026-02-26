import { startServer } from "../../web/server.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
  openapiSpec?: string;
  testsDir?: string;
  dbPath?: string;
}

export async function serveCommand(options: ServeOptions): Promise<number> {
  await startServer({
    port: options.port,
    host: options.host,
    dbPath: options.dbPath,
    openapiSpec: options.openapiSpec,
  });

  // Keep running — Bun.serve keeps the process alive
  return 0;
}
