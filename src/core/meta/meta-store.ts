import { createHash } from "crypto";

/**
 * SHA-256 of the canonical (decycled) JSON form of an OpenAPI document.
 * Used as the freshness hash recorded in `.api-catalog.yaml`,
 * `.api-resources.yaml`, and `.api-fixtures.yaml` so `zond doctor` can
 * detect drift between the local snapshot and its derived artifacts.
 */
export function hashSpec(specContent: string): string {
  return createHash("sha256").update(specContent).digest("hex");
}
