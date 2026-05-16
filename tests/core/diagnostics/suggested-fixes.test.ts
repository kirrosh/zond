import { describe, it, expect } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectPlaceholderSegments,
  findUnfilledEnvKeys,
  buildSuggestedFixes,
} from "../../../src/core/diagnostics/suggested-fixes.ts";

describe("detectPlaceholderSegments (TASK-29)", () => {
  it("flags literal `example` segment", () => {
    const out = detectPlaceholderSegments("https://api.test/users/example/posts");
    expect(out.length).toBe(1);
    expect(out[0]?.segment).toBe("example");
  });

  it("flags all-zero UUID", () => {
    const out = detectPlaceholderSegments("/audiences/00000000-0000-0000-0000-000000000000");
    expect(out.length).toBe(1);
  });

  it("flags `your-id-here` style placeholders", () => {
    const out = detectPlaceholderSegments("/users/your-user-here");
    expect(out.length).toBe(1);
  });

  it("does not flag normal slugs / uuids", () => {
    const out = detectPlaceholderSegments("/users/01HXYZABC/posts/12345");
    expect(out.length).toBe(0);
  });

  it("ignores query string and base URL", () => {
    const out = detectPlaceholderSegments("https://api.test/x/example?id=1");
    expect(out.length).toBe(1);
    expect(out[0]?.segment).toBe("example");
  });

  it("returns [] for null url", () => {
    expect(detectPlaceholderSegments(null)).toEqual([]);
  });
});

describe("findUnfilledEnvKeys (TASK-29)", () => {
  function withEnv<T>(content: string, fn: (path: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "envyaml-"));
    const path = join(dir, ".env.yaml");
    try {
      writeFileSync(path, content, "utf-8");
      return fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("flags <TODO>, empty, example, your-… placeholders", () => {
    withEnv(
      [
        "base_url: https://api.test",
        "auth_token: \"<TODO>\"",
        "audience_id: example",
        "domain: \"\"",
        "verified_email: \"your-email-here\"",
        "real_value: 0b141f35-1234",
      ].join("\n"),
      (p) => {
        const fixes = findUnfilledEnvKeys(p);
        const keys = fixes.map(f => f.key).sort();
        expect(keys).toEqual(["audience_id", "auth_token", "domain", "verified_email"]);
      },
    );
  });

  it("returns [] when env file does not exist", () => {
    expect(findUnfilledEnvKeys("/nonexistent/.env.yaml")).toEqual([]);
  });

  it("returns [] when the YAML root is not an object map", () => {
    withEnv("- just\n- a\n- list\n", (p) => {
      const fixes = findUnfilledEnvKeys(p);
      expect(fixes).toEqual([]);
    });
  });
});

describe("buildSuggestedFixes — combined output", () => {
  it("merges placeholder path-params (404) and unfilled env keys, dedupes segments", () => {
    const dir = mkdtempSync(join(tmpdir(), "envyaml-comb-"));
    const envPath = join(dir, ".env.yaml");
    writeFileSync(envPath, "audience_id: \"<TODO>\"\nbase_url: https://x\n", "utf-8");
    try {
      const fixes = buildSuggestedFixes({
        envFilePath: envPath,
        failures: [
          { response_status: 404, request_url: "/audiences/example", suite_name: "s", test_name: "t1" },
          { response_status: 404, request_url: "/audiences/example", suite_name: "s", test_name: "t2" },
          { response_status: 500, request_url: "/audiences/example", suite_name: "s", test_name: "t3" },
        ],
      });
      const kinds = fixes.map(f => f.kind);
      expect(kinds.filter(k => k === "placeholder_path_param").length).toBe(1); // dedupe
      expect(kinds.filter(k => k === "unfilled_env_key").length).toBe(1);
      expect(fixes.find(f => f.kind === "unfilled_env_key")?.key).toBe("audience_id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns [] when no actionable signals", () => {
    const fixes = buildSuggestedFixes({
      failures: [
        { response_status: 200, request_url: "/users/1", suite_name: "s", test_name: "t" },
      ],
    });
    expect(fixes).toEqual([]);
  });
});
