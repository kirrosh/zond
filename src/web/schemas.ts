import { z } from "@hono/zod-openapi";

// ──────────────────────────────────────────────
// Common
// ──────────────────────────────────────────────

export const ErrorSchema = z.object({
  error: z.string(),
}).openapi("Error");

export const IdParamSchema = z.object({
  id: z.string().transform(Number).pipe(z.number().int().positive()).openapi({ type: "integer", example: 1 }),
});

// ──────────────────────────────────────────────
// Environments
// ──────────────────────────────────────────────

export const EnvironmentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  variables: z.record(z.string(), z.string()),
}).openapi("Environment");

export const EnvironmentListSchema = z.array(EnvironmentSchema).openapi("EnvironmentList");

export const CreateEnvironmentRequest = z.object({
  name: z.string().min(1),
}).openapi("CreateEnvironmentRequest");

export const CreateEnvironmentResponse = z.object({
  id: z.number().int(),
  name: z.string(),
  variables: z.record(z.string(), z.string()),
}).openapi("CreateEnvironmentResponse");

export const UpdateEnvironmentRequest = z.object({
  variables: z.record(z.string(), z.string()),
}).openapi("UpdateEnvironmentRequest");

// ──────────────────────────────────────────────
// Collections
// ──────────────────────────────────────────────

export const CollectionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  test_path: z.string(),
  openapi_spec: z.string().nullable(),
  created_at: z.string(),
}).openapi("Collection");

export const CollectionListSchema = z.array(CollectionSchema).openapi("CollectionList");

export const CreateCollectionRequest = z.object({
  name: z.string().min(1),
  test_path: z.string().min(1),
  openapi_spec: z.string().optional(),
}).openapi("CreateCollectionRequest");

export const CreateCollectionResponse = z.object({
  id: z.number().int(),
  name: z.string(),
  test_path: z.string(),
  openapi_spec: z.string().nullable(),
}).openapi("CreateCollectionResponse");

// ──────────────────────────────────────────────
// Runs
// ──────────────────────────────────────────────

export const RunRequestSchema = z.object({
  path: z.string().min(1),
  env: z.string().optional(),
}).openapi("RunRequest");

export const RunResponseSchema = z.object({
  runId: z.number().int(),
}).openapi("RunResponse");

export const RunDetailSchema = z.object({
  suite_name: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  steps: z.array(z.object({
    name: z.string(),
    status: z.string(),
    duration_ms: z.number(),
    request: z.object({
      method: z.string(),
      url: z.string(),
      headers: z.record(z.string(), z.string()),
    }),
    response: z.object({
      status: z.number().int(),
      headers: z.record(z.string(), z.string()),
      body: z.string(),
      duration_ms: z.number(),
    }).optional(),
    assertions: z.array(z.object({
      field: z.string(),
      expected: z.string(),
      actual: z.string(),
      passed: z.boolean(),
    })),
    captures: z.record(z.string(), z.unknown()),
    error: z.string().optional(),
  })),
}).openapi("RunDetail");

// ──────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────

export const AuthorizeRequest = z.object({
  base_url: z.string().min(1),
  path: z.string().min(1),
  username: z.string().optional(),
  password: z.string().optional(),
}).openapi("AuthorizeRequest");

export const AuthorizeResponse = z.object({
  token: z.string(),
}).openapi("AuthorizeResponse");

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────

export const RunIdParam = z.object({
  runId: z.string().transform(Number).pipe(z.number().int().positive()).openapi({ type: "integer", example: 1 }),
});
