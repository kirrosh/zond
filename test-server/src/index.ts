import { OpenAPIHono } from "@hono/zod-openapi";
import authRoutes from "./routes/auth.ts";
import petsRoutes from "./routes/pets.ts";
import healthRoutes from "./routes/health.ts";

const app = new OpenAPIHono();

// Register bearer security scheme
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// Mount routes
app.route("/", authRoutes);
app.route("/", petsRoutes);
app.route("/", healthRoutes);

// Serve auto-generated OpenAPI spec
app.doc("/doc", {
  openapi: "3.0.0",
  info: { title: "Test Petstore", version: "1.0.0" },
  servers: [{ url: `http://localhost:${parseInt(process.env.PORT || "3000", 10)}`, description: "Local test server" }],
});

export { app };

const port = parseInt(process.env.PORT || "3000", 10);

if (import.meta.main) {
  console.log(`Test server running on http://localhost:${port}`);
  Bun.serve({
    fetch: app.fetch,
    port,
  });
}
