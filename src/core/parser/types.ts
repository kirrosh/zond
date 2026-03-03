export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AssertionRule {
  capture?: string;
  type?: "string" | "integer" | "number" | "boolean" | "array" | "object";
  equals?: unknown;
  contains?: string;
  matches?: string;
  gt?: number;
  lt?: number;
  exists?: boolean;
}

export interface TestStepExpect {
  status?: number;
  body?: Record<string, AssertionRule>;
  headers?: Record<string, string>;
  duration?: number;
}

export interface TestStep {
  name: string;
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
  query?: Record<string, string>;
  expect: TestStepExpect;
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
  tags?: string[];
  base_url?: string;
  headers?: Record<string, string>;
  config: SuiteConfig;
  tests: TestStep[];
  /** Absolute path to the source file, set by yaml-parser */
  filePath?: string;
}

export type Environment = Record<string, string>;
