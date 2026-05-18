import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo } from "../../generator/types.ts";
import type { SecurityClass, SecurityFieldHit } from "./types.ts";

const SSRF_NAME_RE =
  /(^url$|url$|webhook|callback|^redirect_uri$|^endpoint$|^uri$|^href$)/i;
const CRLF_NAME_RE =
  /(^subject$|prefix$|^name$|^title$|^description$|^tag$|^message_subject$)/i;
const OPEN_REDIRECT_NAME_RE =
  /(^redirect$|^next$|^return_to$|^redirect_url$|^redirect_to$|^redirectTo$)/i;

function matchesClass(
  cls: SecurityClass,
  name: string,
  schema: OpenAPIV3.SchemaObject,
): boolean {
  // Skip enum-bounded fields — payload would obviously fail validation
  // and we'd just waste requests on guaranteed-4xx attempts.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return false;
  if (schema.type !== "string" && schema.type !== undefined) return false;
  switch (cls) {
    case "ssrf":
      return SSRF_NAME_RE.test(name) || schema.format === "uri" || schema.format === "url";
    case "crlf":
      return CRLF_NAME_RE.test(name);
    case "open-redirect":
      return OPEN_REDIRECT_NAME_RE.test(name);
  }
}

export function detectFields(
  ep: EndpointInfo,
  classes: SecurityClass[],
): SecurityFieldHit[] {
  const out: SecurityFieldHit[] = [];
  const schema = ep.requestBodySchema;
  if (!schema || !schema.properties) return out;
  for (const [name, propSchema] of Object.entries(schema.properties)) {
    const s = propSchema as OpenAPIV3.SchemaObject;
    for (const cls of classes) {
      if (matchesClass(cls, name, s)) out.push({ field: name, class: cls });
    }
  }
  return out;
}

export const PAYLOADS: Record<SecurityClass, string[]> = {
  ssrf: [
    "http://127.0.0.1:80/",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
  ],
  crlf: [
    "zond-safe\r\nX-Zond-Injected: yes",
    "zond-safe%0d%0aX-Zond-Injected: yes",
  ],
  "open-redirect": [
    "https://zond-attacker.example.tld",
    "//zond-attacker.example.tld",
  ],
};
