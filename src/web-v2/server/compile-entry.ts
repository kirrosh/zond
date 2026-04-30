// TASK-95 spike — production migration tracked separately
// Embedded entry for `bun build --compile`. Static assets are inlined
// from dist/web-v2/ via `with { type: "file" }` so the produced binary
// is fully self-contained.
import indexHtmlPath from "../../../dist/web-v2/index.html" with { type: "file" };
import indexJsPath from "../../../dist/web-v2/index.js" with { type: "file" };
import indexCssPath from "../../../dist/web-v2/index.css" with { type: "file" };
import { createApp } from "./server.ts";

const port = Number(process.env.ZOND_V2_PORT ?? 6421);
const hostname = process.env.ZOND_V2_HOST ?? "localhost";

const api = createApp();

const server = Bun.serve({
  port,
  hostname,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/api/")) {
      return api.fetch(req);
    }

    if (url.pathname === "/index.js") {
      return new Response(Bun.file(indexJsPath), {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname === "/index.css") {
      return new Response(Bun.file(indexCssPath), {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // SPA fallback — every other path serves index.html
    return new Response(Bun.file(indexHtmlPath), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`[zond v2] listening on http://${hostname}:${server.port}`);
