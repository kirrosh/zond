import Ajv from "ajv";
import addFormats from "ajv-formats";
import { STRICT_RFC3339_DATE_TIME } from "../runner/schema-validator.ts";

const ajv = new Ajv({ strict: false, allErrors: false });
addFormats(ajv);
ajv.addFormat("date-time", { type: "string", validate: STRICT_RFC3339_DATE_TIME });

const SUPPORTED = new Set([
  "date-time", "date", "time",
  "email", "idn-email",
  "uri", "uri-reference", "url",
  "uuid",
  "ipv4", "ipv6",
  "hostname", "idn-hostname",
  "regex",
  "byte", "binary", "password",
]);

const cache = new Map<string, (v: unknown) => boolean>();

/**
 * True if `value` satisfies the OpenAPI/JSON-Schema `format`. Returns true for
 * unknown formats (we can't say). Returns true for non-string values
 * (OpenAPI's `format` only constrains strings).
 */
export function validateExampleAgainstFormat(value: unknown, format: string): boolean {
  if (typeof value !== "string") return true;
  if (!SUPPORTED.has(format)) return true;
  if (format === "url") format = "uri";

  let validator = cache.get(format);
  if (!validator) {
    try {
      validator = ajv.compile({ type: "string", format }) as (v: unknown) => boolean;
      cache.set(format, validator);
    } catch {
      return true;
    }
  }
  return validator(value);
}
