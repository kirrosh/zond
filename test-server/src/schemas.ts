import { z } from "@hono/zod-openapi";

export const LoginRequestSchema = z.object({
  username: z.string().openapi({ example: "admin" }),
  password: z.string().openapi({ example: "admin" }),
});

export const LoginResponseSchema = z.object({
  token: z.string().openapi({ example: "eyJhbGciOiJIUzI1NiIs..." }),
});

export const ErrorSchema = z.object({
  error: z.string().openapi({ example: "Not found" }),
});

export const PetSchema = z.object({
  id: z.number().int().openapi({ example: 1 }),
  name: z.string().openapi({ example: "Buddy" }),
  tag: z.string().optional().openapi({ example: "dog" }),
  status: z.enum(["available", "pending", "sold"]).openapi({ example: "available" }),
});

export const NewPetSchema = z.object({
  name: z.string().openapi({ example: "Buddy" }),
  tag: z.string().optional().openapi({ example: "dog" }),
  status: z.enum(["available", "pending", "sold"]).default("available").openapi({ example: "available" }),
});

export const PetListSchema = z.array(PetSchema);

export type Pet = z.infer<typeof PetSchema>;
export type NewPet = z.infer<typeof NewPetSchema>;
