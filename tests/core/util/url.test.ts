import { describe, it, expect } from "bun:test";
import { joinBaseAndPath, buildUrl } from "../../../src/core/util/url.ts";

describe("joinBaseAndPath", () => {
  it("concatenates base and path", () => {
    expect(joinBaseAndPath("https://api.test.local", "/v1/users")).toBe(
      "https://api.test.local/v1/users",
    );
  });

  it("strips a single trailing slash from base", () => {
    expect(joinBaseAndPath("https://api.test.local/", "/v1/users")).toBe(
      "https://api.test.local/v1/users",
    );
  });

  it("strips repeated trailing slashes from base", () => {
    expect(joinBaseAndPath("https://api.test.local///", "/v1/users")).toBe(
      "https://api.test.local/v1/users",
    );
  });

  it("returns path verbatim when base is undefined", () => {
    expect(joinBaseAndPath(undefined, "/v1/users")).toBe("/v1/users");
  });

  it("returns path verbatim when base is empty string", () => {
    expect(joinBaseAndPath("", "/v1/users")).toBe("/v1/users");
  });
});

describe("buildUrl", () => {
  it("returns plain url when query is omitted", () => {
    expect(buildUrl("https://api.test.local", "/v1/users")).toBe(
      "https://api.test.local/v1/users",
    );
  });

  it("returns plain url when query is empty", () => {
    expect(buildUrl("https://api.test.local", "/v1/users", {})).toBe(
      "https://api.test.local/v1/users",
    );
  });

  it("appends string query params", () => {
    expect(buildUrl("https://api.test.local", "/v1/users", { limit: "10" })).toBe(
      "https://api.test.local/v1/users?limit=10",
    );
  });

  it("coerces number and boolean query values", () => {
    const url = buildUrl("https://api.test.local", "/v1/users", {
      limit: 10,
      active: true,
    });
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("limit")).toBe("10");
    expect(qs.get("active")).toBe("true");
  });

  it("URL-encodes special characters in values", () => {
    const url = buildUrl("https://api.test.local", "/v1/search", {
      q: "hello world&foo",
    });
    expect(url).toBe("https://api.test.local/v1/search?q=hello+world%26foo");
  });

  it("works without a base url", () => {
    expect(buildUrl(undefined, "/v1/users", { limit: "5" })).toBe(
      "/v1/users?limit=5",
    );
  });
});
