import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode("test-server-secret-key-for-jwt");

export { SECRET };

export const jwtAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, SECRET);
    c.set("jwtPayload" as never, payload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});
