/**
 * ARV-53: unit tests for the single --api resolver
 * (`src/cli/util/api-context.ts`). The chain it owns:
 *   local opt > ancestor opt > ZOND_API_GLOBAL > ZOND_API > .zond/current-api
 *
 * The first three layers are exercised here; the file-on-disk layer
 * (`.zond/current-api`) is covered by `tests/cli/api-flag-no-required-option.test.ts`
 * and the live probe-fallback test — keeping this suite pure (no fs writes)
 * means it stays fast and parallel-safe.
 */
import { describe, test, expect, afterEach } from "bun:test";

import {
  getApi,
  resolveApi,
  type CommandLike,
} from "../../../src/cli/util/api-context.ts";

const ENV_KEYS = ["ZOND_API_GLOBAL", "ZOND_API"] as const;

function makeCmd(opts: Record<string, unknown>, parent?: CommandLike | null): CommandLike {
  return { opts: () => opts, parent: parent ?? null };
}

describe("ARV-53: resolveApi / getApi", () => {
  const original: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) original[k] = process.env[k];

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  test("local opts.api wins over every other layer", () => {
    process.env.ZOND_API_GLOBAL = "from-global";
    const parent = makeCmd({ api: "from-parent" });
    const cmd = makeCmd({ api: "from-local" }, parent);
    expect(getApi(cmd, { api: "from-local" })).toBe("from-local");
    const r = resolveApi(cmd, { api: "from-local" });
    expect(r).toEqual({ ok: true, api: "from-local", source: "local" });
  });

  test("ancestor opts.api wins when local is empty", () => {
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    const parent = makeCmd({ api: "from-parent" });
    const cmd = makeCmd({}, parent);
    const r = resolveApi(cmd, {});
    expect(r).toEqual({ ok: true, api: "from-parent", source: "ancestor" });
  });

  test("walks up multi-level ancestor chain", () => {
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    const root = makeCmd({ api: "from-root" });
    const mid = makeCmd({}, root);
    const cmd = makeCmd({}, mid);
    expect(getApi(cmd, {})).toBe("from-root");
  });

  test("ZOND_API_GLOBAL (program.ts preAction mirror) fills in when nothing on the command tree", () => {
    process.env.ZOND_API_GLOBAL = "from-global";
    delete process.env.ZOND_API;
    const cmd = makeCmd({});
    const r = resolveApi(cmd, {});
    // readCurrentApi() handles the env layer — we just assert the value
    // surfaces from the right source.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.api).toBe("from-global");
      expect(r.source).toBe("current");
    }
  });

  test("ZOND_API user env fills in when ZOND_API_GLOBAL is unset", () => {
    delete process.env.ZOND_API_GLOBAL;
    process.env.ZOND_API = "from-user-env";
    const cmd = makeCmd({});
    expect(getApi(cmd, {})).toBe("from-user-env");
  });

  test("returns ok:false (getApi: undefined) when nothing resolves anywhere", () => {
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    const cmd = makeCmd({});
    expect(resolveApi(cmd, {})).toEqual({ ok: false });
    expect(getApi(cmd, {})).toBeUndefined();
  });

  test("tolerates undefined `cmd` — env-only resolution still works", () => {
    process.env.ZOND_API_GLOBAL = "from-global";
    delete process.env.ZOND_API;
    expect(getApi(undefined, undefined)).toBe("from-global");
  });

  test("ignores blank-string local opts (treats whitespace as 'unset')", () => {
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    const parent = makeCmd({ api: "from-parent" });
    const cmd = makeCmd({ api: "   " }, parent);
    expect(getApi(cmd, { api: "   " })).toBe("from-parent");
  });
});
