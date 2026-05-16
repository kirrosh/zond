import { describe, test, expect } from "bun:test";
import { AUTH_PATH_RE } from "../../src/core/runner/auth-path.ts";

describe("AUTH_PATH_RE", () => {
  test("positive: each keyword matches at top-level path segment", () => {
    expect(AUTH_PATH_RE.test("/auth")).toBe(true);
    expect(AUTH_PATH_RE.test("/login")).toBe(true);
    expect(AUTH_PATH_RE.test("/signin")).toBe(true);
    expect(AUTH_PATH_RE.test("/token")).toBe(true);
    expect(AUTH_PATH_RE.test("/oauth")).toBe(true);
  });

  test("matches nested segments (deeper path) — keyword anywhere after a slash", () => {
    expect(AUTH_PATH_RE.test("/api/v1/auth/refresh")).toBe(true);
    expect(AUTH_PATH_RE.test("/api/users/login")).toBe(true);
    expect(AUTH_PATH_RE.test("/oauth/callback")).toBe(true);
  });

  test("case-insensitive — Auth, LOGIN, SignIn all match", () => {
    expect(AUTH_PATH_RE.test("/Auth")).toBe(true);
    expect(AUTH_PATH_RE.test("/LOGIN")).toBe(true);
    expect(AUTH_PATH_RE.test("/SignIn")).toBe(true);
    expect(AUTH_PATH_RE.test("/OAuth")).toBe(true);
  });

  test("word-boundary: /authors / /loginrecord do NOT match", () => {
    // \b after the keyword prevents matching unrelated words that happen to
    // start with the same letters.
    expect(AUTH_PATH_RE.test("/authors")).toBe(false);
    expect(AUTH_PATH_RE.test("/loginrecord")).toBe(false);
    expect(AUTH_PATH_RE.test("/tokenize")).toBe(false);
    expect(AUTH_PATH_RE.test("/oauthor")).toBe(false);
  });

  test("missing leading slash does not match (anchored to /keyword)", () => {
    expect(AUTH_PATH_RE.test("auth")).toBe(false);
    expect(AUTH_PATH_RE.test("login")).toBe(false);
  });

  test("empty path does not match", () => {
    expect(AUTH_PATH_RE.test("")).toBe(false);
    expect(AUTH_PATH_RE.test("/")).toBe(false);
  });
});
