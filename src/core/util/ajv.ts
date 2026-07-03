import Ajv2020 from "ajv/dist/2020.js";
import Ajv from "ajv";
import addFormats from "ajv-formats";

/** OpenAPI 3.1 → JSON Schema Draft 2020-12 (Ajv2020); 3.0 → Draft 4/7-ish
 *  (plain Ajv). Both get the `ajv-formats` format keywords registered. */
export function makeAjv(isV31: boolean, opts: ConstructorParameters<typeof Ajv>[0] = {}): Ajv {
  const ajv = isV31
    ? new (Ajv2020 as unknown as typeof Ajv)(opts)
    : new Ajv(opts);
  addFormats(ajv);
  return ajv;
}
