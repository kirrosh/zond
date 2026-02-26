import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PetSchema, NewPetSchema, PetListSchema, ErrorSchema } from "../schemas.ts";
import { jwtAuth } from "../middleware/jwt.ts";
import * as store from "../store.ts";

const app = new OpenAPIHono();

// Apply JWT auth to all pet routes
app.use("/pets/*", jwtAuth);
app.use("/pets", jwtAuth);

const PetIdParam = z.object({
  id: z.string().pipe(z.coerce.number().int()).openapi({ param: { name: "id", in: "path" }, example: "1" }),
});

// GET /pets
const listPetsRoute = createRoute({
  method: "get",
  path: "/pets",
  operationId: "listPets",
  summary: "List all pets",
  tags: ["pets"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "A list of pets",
      content: { "application/json": { schema: PetListSchema } },
    },
  },
});

app.openapi(listPetsRoute, (c) => {
  return c.json(store.listPets(), 200);
});

// POST /pets
const createPetRoute = createRoute({
  method: "post",
  path: "/pets",
  operationId: "createPet",
  summary: "Create a pet",
  tags: ["pets"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: NewPetSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Pet created",
      content: { "application/json": { schema: PetSchema } },
    },
  },
});

app.openapi(createPetRoute, (c) => {
  const data = c.req.valid("json");
  const pet = store.createPet(data);
  return c.json(pet, 201);
});

// GET /pets/:id
const getPetRoute = createRoute({
  method: "get",
  path: "/pets/{id}",
  operationId: "getPet",
  summary: "Get a pet by ID",
  tags: ["pets"],
  security: [{ bearerAuth: [] }],
  request: { params: PetIdParam },
  responses: {
    200: {
      description: "A pet",
      content: { "application/json": { schema: PetSchema } },
    },
    404: {
      description: "Pet not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(getPetRoute, (c) => {
  const { id } = c.req.valid("param");
  const pet = store.getPet(id);
  if (!pet) return c.json({ error: "Pet not found" }, 404);
  return c.json(pet, 200);
});

// PUT /pets/:id
const updatePetRoute = createRoute({
  method: "put",
  path: "/pets/{id}",
  operationId: "updatePet",
  summary: "Update a pet",
  tags: ["pets"],
  security: [{ bearerAuth: [] }],
  request: {
    params: PetIdParam,
    body: {
      content: { "application/json": { schema: NewPetSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Pet updated",
      content: { "application/json": { schema: PetSchema } },
    },
    404: {
      description: "Pet not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(updatePetRoute, (c) => {
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  const pet = store.updatePet(id, data);
  if (!pet) return c.json({ error: "Pet not found" }, 404);
  return c.json(pet, 200);
});

// DELETE /pets/:id
const deletePetRoute = createRoute({
  method: "delete",
  path: "/pets/{id}",
  operationId: "deletePet",
  summary: "Delete a pet",
  tags: ["pets"],
  security: [{ bearerAuth: [] }],
  request: { params: PetIdParam },
  responses: {
    204: { description: "Pet deleted" },
    404: {
      description: "Pet not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(deletePetRoute, (c) => {
  const { id } = c.req.valid("param");
  if (!store.deletePet(id)) return c.json({ error: "Pet not found" }, 404);
  return c.body(null, 204);
});

export default app;
