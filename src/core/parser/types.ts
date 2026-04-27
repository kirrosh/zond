export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AssertionRule {
  capture?: string;
  type?: "string" | "integer" | "number" | "boolean" | "array" | "object" | "null";
  equals?: unknown;
  not_equals?: unknown;
  contains?: string;
  not_contains?: string;
  matches?: string;
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
  exists?: boolean;
  length?: number;
  length_gt?: number;
  length_gte?: number;
  length_lt?: number;
  length_lte?: number;
  each?: Record<string, AssertionRule>;
  contains_item?: Record<string, AssertionRule>;
  set_equals?: unknown;
}

export interface TestStepExpect {
  status?: number | number[];
  body?: Record<string, AssertionRule>;
  headers?: Record<string, string | AssertionRule>;
  duration?: number;
}

export interface RetryUntil {
  condition: string;
  max_attempts: number;
  delay_ms: number;
}

export interface ForEach {
  var: string;
  in: unknown;
}

export interface MultipartFileField {
  file: string;
  filename?: string;
  content_type?: string;
}

export type MultipartField = string | MultipartFileField;

export interface TestStep {
  name: string;
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  multipart?: Record<string, MultipartField>;
  query?: Record<string, string>;
  expect: TestStepExpect;
  skip_if?: string;
  retry_until?: RetryUntil;
  for_each?: ForEach;
  set?: Record<string, unknown>;
}

export interface SuiteConfig {
  timeout: number;
  retries: number;
  retry_delay: number;
  follow_redirects: boolean;
  verify_ssl: boolean;
}

export interface TestSuite {
  name: string;
  description?: string;
  /** If true, this suite runs before all regular suites and its captures are shared into their env */
  setup?: boolean;
  tags?: string[];
  base_url?: string;
  headers?: Record<string, string>;
  config: SuiteConfig;
  tests: TestStep[];
  /** Absolute path to the source file, set by yaml-parser */
  filePath?: string;
}

export type Environment = Record<string, string>;
