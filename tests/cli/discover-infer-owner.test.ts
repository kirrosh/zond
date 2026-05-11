/**
 * ARV-69 (feedback round-02 / F10): when an API's spec uses generic {id}
 * placeholders instead of named path-params (Resend-style /domains/{id}
 * /segments/{id} /logs/{id}), the resource map's fkDependencies don't
 * link the `domain_id` / `segment_id` / `log_id` manifest vars to the
 * list endpoint. Discover then misses them and the user has to harvest
 * by hand. inferOwnerFromVarName closes the gap by stem-matching the var
 * name against resource names (singular ↔ plural, case-insensitive).
 */
import { describe, test, expect } from "bun:test";
import { inferOwnerFromVarName, type ApiResourceMapYaml } from "../../src/cli/commands/discover.ts";

const MAP: ApiResourceMapYaml = {
  resources: [
    { resource: "domains", basePath: "/domains", idParam: "id", captureField: "id", endpoints: { list: "GET /domains", read: "GET /domains/{id}" }, fkDependencies: [] },
    { resource: "segments", basePath: "/segments", idParam: "id", captureField: "id", endpoints: { list: "GET /segments" }, fkDependencies: [] },
    { resource: "audience", basePath: "/audiences", idParam: "audience_id", captureField: "id", endpoints: { list: "GET /audiences" }, fkDependencies: [] },
    { resource: "no_list_resource", basePath: "/x", idParam: "id", captureField: "id", endpoints: {}, fkDependencies: [] },
  ],
} as unknown as ApiResourceMapYaml;

describe("inferOwnerFromVarName (ARV-69)", () => {
  test("snake_case FK (`domain_id`) matches plural resource `domains`", () => {
    const t = inferOwnerFromVarName("domain_id", MAP);
    expect(t?.ownerResource).toBe("domains");
    expect(t?.listLabel).toBe("GET /domains");
  });

  test("camelCase FK (`segmentId`) matches `segments`", () => {
    const t = inferOwnerFromVarName("segmentId", MAP);
    expect(t?.ownerResource).toBe("segments");
  });

  test("`_uuid` suffix is honoured", () => {
    const t = inferOwnerFromVarName("domain_uuid", MAP);
    expect(t?.ownerResource).toBe("domains");
  });

  test("singular resource (`audience`) matches plural var (`audiences_id` would not, but `audience_id` does)", () => {
    const t = inferOwnerFromVarName("audience_id", MAP);
    expect(t?.ownerResource).toBe("audience");
  });

  test("resource without list endpoint is rejected", () => {
    const map: ApiResourceMapYaml = {
      resources: [
        { resource: "no_list_resource", basePath: "/x", idParam: "id", captureField: "id", endpoints: {}, fkDependencies: [] },
      ],
    } as unknown as ApiResourceMapYaml;
    expect(inferOwnerFromVarName("no_list_resource_id", map)).toBeUndefined();
  });

  test("vars without an FK-shape suffix don't match anything", () => {
    expect(inferOwnerFromVarName("base_url", MAP)).toBeUndefined();
    expect(inferOwnerFromVarName("auth_token", MAP)).toBeUndefined();
  });

  test("no candidate found → undefined (so caller stays on the failed:no-list-endpoint path)", () => {
    expect(inferOwnerFromVarName("widgets_id", MAP)).toBeUndefined();
  });
});
