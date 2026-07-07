/**
 * ARV-334: the hint-less default fixture harvest used to put a numeric `id`
 * into a slot like {owner} even when the list item also exposed a string
 * identifier (GitHub owner→login), collapsing the whole depth pass. zond
 * can't know which field the path wants — that's the agent's call — so it
 * now reports the ambiguity (miss-ambiguous-id) instead of guessing.
 *
 * This pins the deterministic, response-only ambiguity signal. It stays
 * SILENT on the common unambiguous cases so it doesn't re-grow into a
 * noisy heuristic.
 */
import { describe, test, expect } from "bun:test";
import { ambiguousStringIdSibling } from "../../src/cli/commands/discover.ts";

describe("ambiguousStringIdSibling (ARV-334)", () => {
  const gh = [{ id: 583231, login: "octocat", name: "The Octocat" }];

  test("fires: hint-less var, numeric id, string login sibling", () => {
    expect(ambiguousStringIdSibling(gh, "owner")).toBe("login");
  });

  test("fires through a data-envelope too", () => {
    expect(ambiguousStringIdSibling({ data: gh }, "owner")).toBe("login");
  });

  test("numeric id as a numeric-string still fires", () => {
    expect(ambiguousStringIdSibling([{ id: "42", slug: "web" }], "project")).toBe("slug");
  });

  // --- must stay silent (no re-grown noise) ---

  test("silent when the var carries an explicit field hint", () => {
    expect(ambiguousStringIdSibling(gh, "owner_id")).toBeUndefined();
    expect(ambiguousStringIdSibling(gh, "owner_slug")).toBeUndefined();
  });

  test("silent when id is a non-numeric string (opaque id, unambiguous)", () => {
    expect(ambiguousStringIdSibling([{ id: "cus_abc123", name: "Acme" }], "customer")).toBeUndefined();
  });

  test("silent when no string-identifier sibling exists (id-only)", () => {
    expect(ambiguousStringIdSibling([{ id: 7 }], "thing")).toBeUndefined();
    // a display `name` alone is not an identifier sibling
    expect(ambiguousStringIdSibling([{ id: 7, name: "Widget" }], "thing")).toBeUndefined();
  });

  test("silent on empty / unrecognized shapes", () => {
    expect(ambiguousStringIdSibling([], "owner")).toBeUndefined();
    expect(ambiguousStringIdSibling({}, "owner")).toBeUndefined();
    expect(ambiguousStringIdSibling(null, "owner")).toBeUndefined();
  });
});
