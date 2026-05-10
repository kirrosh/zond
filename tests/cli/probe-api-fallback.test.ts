/**
 * ARV-33: `zond probe mass-assignment --api foo` failed with
 * "Missing --env <file>" because commander absorbs `--api` at the global
 * scope and leaves `opts.api` undefined for the subcommand. The probe
 * actions were the only `--api`-aware spots that didn't run the same
 * fallback chain prepare-fixtures / audit / ARV-29 use.
 *
 * `resolveProbeApi` centralises that chain: opts → parent.opts → ZOND_API_GLOBAL
 * / ZOND_API / .zond/current-api.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { resolveProbeApi } from "../../src/cli/commands/probe.ts";

const ENV_KEYS = ["ZOND_API_GLOBAL", "ZOND_API"] as const;

describe("ARV-33: resolveProbeApi fallback chain", () => {
  const original: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) original[k] = process.env[k];

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  test("uses opts.api when present", () => {
    process.env.ZOND_API_GLOBAL = "from-global";
    expect(resolveProbeApi("from-opts", { parent: { opts: () => ({ api: "from-parent" }) } })).toBe("from-opts");
  });

  test("falls back to parent.opts().api when opts.api is empty", () => {
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    expect(resolveProbeApi(undefined, { parent: { opts: () => ({ api: "from-parent" }) } })).toBe("from-parent");
  });

  test("falls back to ZOND_API_GLOBAL when both opts and parent are empty", () => {
    process.env.ZOND_API_GLOBAL = "from-global";
    delete process.env.ZOND_API;
    expect(resolveProbeApi(undefined, { parent: { opts: () => ({}) } })).toBe("from-global");
  });

  test("returns undefined when nothing is set anywhere", () => {
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    expect(resolveProbeApi(undefined, undefined)).toBeUndefined();
  });
});
