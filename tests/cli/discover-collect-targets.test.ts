/**
 * ARV-133: cascade target collection — when a resource has no fkDep edge to
 * another resource, its own idParam (linked to its list endpoint) must still
 * be a cascade target. Without this, root-level required path-params like
 * `domain_id`, `webhook_id`, `template_id` silently dropped out of
 * `prepare-fixtures --cascade --seed`, leaving 9/12 vars unattempted.
 */
import { describe, test, expect } from "bun:test";
import { collectTargets, type ApiResourceMapYaml, type FixtureManifestYaml } from "../../src/cli/commands/discover.ts";

const map = (resources: ApiResourceMapYaml["resources"]): ApiResourceMapYaml =>
  ({ resources } as unknown as ApiResourceMapYaml);

const r = (name: string, idParam: string, list: string | null, fkDeps: any[] = []): any => ({
  resource: name,
  basePath: `/${name}`,
  idParam,
  captureField: "id",
  endpoints: list ? { list } : {},
  fkDependencies: fkDeps,
});

describe("collectTargets (ARV-133 cascade scope)", () => {
  test("includes each resource's own idParam → its list endpoint", () => {
    const m = map([
      r("domains", "domain_id", "GET /domains"),
      r("webhooks", "webhook_id", "GET /webhooks"),
      r("api-keys", "api_key_id", "GET /api-keys"),
    ]);
    const targets = collectTargets(m);
    expect(targets.map(t => t.varName).sort()).toEqual(["api_key_id", "domain_id", "webhook_id"]);
    expect(targets.find(t => t.varName === "domain_id")?.listLabel).toBe("GET /domains");
  });

  test("still emits fkDep targets (parent-FK edges)", () => {
    const m = map([
      r("emails", "email_id", "GET /emails"),
      r("attachments", "", null, [
        { var: "email_id", param: "email_id", in: "path", ownerResource: "emails" },
      ]),
    ]);
    const targets = collectTargets(m);
    // email_id is both fkDep AND emails.idParam — must dedupe to one entry
    expect(targets.filter(t => t.varName === "email_id").length).toBe(1);
  });

  test("resource with no list endpoint → skipped (no harvest source)", () => {
    const m = map([
      r("write-only", "wo_id", null),
      r("normal", "normal_id", "GET /normal"),
    ]);
    const targets = collectTargets(m);
    expect(targets.map(t => t.varName).sort()).toEqual(["normal_id"]);
  });

  test("resource with empty idParam (list-only nested) → skipped", () => {
    const m = map([
      r("logs", "", "GET /logs"),
      r("domains", "domain_id", "GET /domains"),
    ]);
    const targets = collectTargets(m);
    expect(targets.map(t => t.varName)).toEqual(["domain_id"]);
  });

  test("manifest entries with no fkDep edge still resolve via inferOwnerFromVarName", () => {
    const m = map([
      r("domains", "domain_id", "GET /domains"),
      r("segments", "segment_id", "GET /segments"),
    ]);
    const manifest: FixtureManifestYaml = {
      fixtures: [
        // body-fk var that names a domain by its singular stem
        { name: "domain_id", source: "body-fk", required: true } as any,
        // path var matching another resource via plural stem
        { name: "segment_id", source: "path", required: true } as any,
        // unrelated var — should not match
        { name: "auth_token", source: "auth", required: true } as any,
      ],
    } as unknown as FixtureManifestYaml;
    const targets = collectTargets(m, manifest);
    expect(targets.map(t => t.varName).sort()).toEqual(["domain_id", "segment_id"]);
  });

  test("manifest entries already covered by fkDep are not duplicated", () => {
    const m = map([
      r("audiences", "audience_id", "GET /audiences"),
      r("contacts", "contact_id", "GET /contacts", [
        { var: "audience_id", param: "audience_id", in: "body", ownerResource: "audiences" },
      ]),
    ]);
    const manifest: FixtureManifestYaml = {
      fixtures: [
        { name: "audience_id", source: "body-fk", required: true } as any,
      ],
    } as unknown as FixtureManifestYaml;
    const targets = collectTargets(m, manifest);
    expect(targets.filter(t => t.varName === "audience_id").length).toBe(1);
  });

  test("regression: resend-shaped map yields all 9 previously-missing vars (ARV-133 AC#4)", () => {
    // After ARV-40, generic {id} is rewritten per resource, so resource-builder
    // emits 9 distinct idParams on the resend spec. Cascade must attempt every
    // one whose resource has a list endpoint.
    const m = map([
      r("emails", "email_id", "GET /emails"),
      r("domains", "domain_id", "GET /domains"),
      r("api-keys", "api_key_id", "GET /api-keys"),
      r("templates", "template_id", "GET /templates"),
      r("contacts", "contact_id", "GET /contacts"),
      r("broadcasts", "broadcast_id", "GET /broadcasts"),
      r("webhooks", "webhook_id", "GET /webhooks"),
      r("segments", "segment_id", "GET /segments"),
      r("topics", "topic_id", "GET /topics"),
      r("contact-properties", "contact_property_id", "GET /contact-properties"),
      r("automations", "automation_id", "GET /automations"),
    ]);
    const names = collectTargets(m).map(t => t.varName).sort();
    expect(names).toContain("domain_id");
    expect(names).toContain("api_key_id");
    expect(names).toContain("webhook_id");
    expect(names).toContain("segment_id");
    expect(names).toContain("automation_id");
    expect(names).toContain("template_id");
    expect(names).toContain("contact_id");
    expect(names).toContain("broadcast_id");
    expect(names).toContain("topic_id");
  });
});
