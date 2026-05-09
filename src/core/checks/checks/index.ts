/**
 * Auto-registers built-in checks at first import. ARV-1 ships with one
 * seed check (`not_a_server_error`); ARV-2/3/4 fill in the remaining
 * 11 conformance/security checks alongside it.
 *
 * Side-effect import is intentional: anywhere the runner or CLI loads
 * `core/checks` it triggers this module and the registry is populated
 * exactly once (Node/Bun ESM module cache guarantees idempotency).
 */
import { registerCheck } from "../registry.ts";
import { notAServerError } from "./not_a_server_error.ts";
import { statusCodeConformance } from "./status_code_conformance.ts";
import { contentTypeConformance } from "./content_type_conformance.ts";
import { responseHeadersConformance } from "./response_headers_conformance.ts";
import { responseSchemaConformance } from "./response_schema_conformance.ts";
import { missingRequiredHeader } from "./missing_required_header.ts";
import { unsupportedMethod } from "./unsupported_method.ts";

let registered = false;

export function registerBuiltinChecks(): void {
  if (registered) return;
  // ARV-1 seed.
  registerCheck(notAServerError);
  // ARV-2 — 6 conformance checks (7 total with the seed).
  registerCheck(statusCodeConformance);
  registerCheck(contentTypeConformance);
  registerCheck(responseHeadersConformance);
  registerCheck(responseSchemaConformance);
  registerCheck(missingRequiredHeader);
  registerCheck(unsupportedMethod);
  registered = true;
}

registerBuiltinChecks();
