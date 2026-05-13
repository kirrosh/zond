/**
 * Disambiguate generic path-parameter names that collide across resources.
 *
 * Some OpenAPI specs declare item paths as `/<resource>/{id}` instead of
 * `/<resource>/{<resource>_id}` — fine
 * within one resource, catastrophic across many: the manifest derives one
 * global `id` var, `.env.yaml` stores one value, and N>1 CRUD suites end up
 * pointing at the same uuid (false 404 at best; false 200 against a stranger's
 * object at worst — the GET returns a real object so the test "passes" while
 * having tested nothing of the target resource).
 *
 * ARV-40 fix: when a generic param name (`id`, `slug`, `uuid`, `key`,
 * `identifier`) appears under more than one distinct parent collection in the
 * spec, rewrite each occurrence to `<parent_singular>_<param>` in
 * EndpointInfo.path AND the matching parameter entry. All downstream code
 * (resource map, fixture manifest, suite generator, mass-assignment probe)
 * then sees per-resource var names without any extra plumbing.
 *
 * The on-disk OpenAPI spec.json is untouched — this is an in-memory
 * normalisation. Coverage matches by structural shape (`{x}` is `{x}`), and
 * the runner substitutes `{{var}}` after path templating, so renaming
 * `{id}` → `{template_id}` only affects how zond *names* the variable.
 */

import type { EndpointInfo } from "./types.ts";

const GENERIC_PARAM_NAMES = new Set(["id", "slug", "uuid", "key", "name", "identifier"]);

function isParamSeg(seg: string | undefined): seg is string {
  return !!seg && /^\{[^}]+\}$/.test(seg);
}

/** English singularization sufficient for resource-collection nouns. */
function singularize(word: string): string {
  if (word.length > 3 && /ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (word.length > 3 && /(ch|sh|x|ss|z)es$/i.test(word)) return word.slice(0, -2);
  if (word.length > 1 && /[^s]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** Turn a path segment (`contact-properties`) into an identifier stem (`contact_property`). */
function segToStem(seg: string): string {
  return singularize(seg).replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

interface Occurrence {
  ep: EndpointInfo;
  /** Index of the {param} segment in the path. */
  segIdx: number;
}

/** Mutates endpoints in place; returns the same array for chaining. */
export function disambiguateGenericPathParams(endpoints: EndpointInfo[]): EndpointInfo[] {
  // param-name → parent-seg → occurrences
  const byParamParent = new Map<string, Map<string, Occurrence[]>>();

  for (const ep of endpoints) {
    const segs = ep.path.split("/");
    for (let i = 0; i < segs.length; i++) {
      const m = /^\{([^}]+)\}$/.exec(segs[i]!);
      if (!m) continue;
      const paramName = m[1]!;
      if (!GENERIC_PARAM_NAMES.has(paramName.toLowerCase())) continue;
      // Walk back to nearest non-param non-empty segment as "parent".
      let parent: string | undefined;
      for (let j = i - 1; j >= 0; j--) {
        const s = segs[j]!;
        if (s && !isParamSeg(s)) {
          parent = s;
          break;
        }
      }
      if (!parent) continue;
      let perParent = byParamParent.get(paramName);
      if (!perParent) {
        perParent = new Map();
        byParamParent.set(paramName, perParent);
      }
      const arr = perParent.get(parent) ?? [];
      arr.push({ ep, segIdx: i });
      perParent.set(parent, arr);
    }
  }

  for (const [paramName, perParent] of byParamParent) {
    // Only rename when the param collides across ≥2 parents — single-resource
    // use of `{id}` stays as-is to avoid churning user .env.yaml entries on
    // APIs where the convention isn't a problem.
    if (perParent.size < 2) continue;
    const lowerParam = paramName.toLowerCase();
    for (const [parent, occs] of perParent) {
      const stem = segToStem(parent);
      if (!stem) continue;
      const newName = lowerParam === "id" ? `${stem}_id` : `${stem}_${lowerParam}`;
      // Skip rename if newName collides with an unrelated existing name
      // for the same endpoint (would corrupt parameters[]). Cheap guard.
      for (const occ of occs) {
        // ARV-183: preserve the original spec path before mutating, so
        // downstream checks (status_code_conformance, response_headers_conformance)
        // can still look up `doc.paths[...]` by string equality. Set only
        // on first rename — subsequent renames of the same endpoint keep
        // the truly original path.
        if (occ.ep.originalPath === undefined) occ.ep.originalPath = occ.ep.path;
        const segs = occ.ep.path.split("/");
        segs[occ.segIdx] = `{${newName}}`;
        occ.ep.path = segs.join("/");
        const param = occ.ep.parameters.find(p => p.name === paramName && p.in === "path");
        if (param) (param as { name: string }).name = newName;
      }
    }
  }

  return endpoints;
}
