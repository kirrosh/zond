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

let registered = false;

export function registerBuiltinChecks(): void {
  if (registered) return;
  registerCheck(notAServerError);
  registered = true;
}

registerBuiltinChecks();
