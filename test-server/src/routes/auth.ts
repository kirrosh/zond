import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { SignJWT } from "jose";
import { LoginRequestSchema, LoginResponseSchema, ErrorSchema } from "../schemas.ts";
import { SECRET } from "../middleware/jwt.ts";

const app = new OpenAPIHono();

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  operationId: "login",
  summary: "Authenticate and get a JWT token",
  tags: ["auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: LoginRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Login successful",
      content: {
        "application/json": {
          schema: LoginResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid credentials",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(loginRoute, async (c) => {
  const { username, password } = c.req.valid("json");

  if (username !== "admin" || password !== "admin") {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = await new SignJWT({ sub: username, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);

  return c.json({ token }, 200);
});

export default app;
