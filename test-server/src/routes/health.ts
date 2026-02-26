import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const app = new OpenAPIHono();

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "healthCheck",
  summary: "Health check endpoint",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: z.object({
            status: z.string().openapi({ example: "ok" }),
            uptime: z.number().openapi({ example: 12345 }),
          }),
        },
      },
    },
  },
});

app.openapi(healthRoute, (c) => {
  return c.json({ status: "ok", uptime: Math.floor(process.uptime()) }, 200);
});

export default app;
