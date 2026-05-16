import { describe, it, expect } from "bun:test";
import { detectCiContext } from "../../../src/core/runner/ci-context.ts";

describe("detectCiContext (TASK-116)", () => {
  it("returns trigger=manual for empty env", () => {
    const c = detectCiContext({});
    expect(c.trigger).toBe("manual");
    expect(c.commit_sha).toBeNull();
    expect(c.branch).toBeNull();
    expect(c.provider).toBeNull();
  });

  it("detects GitHub Actions", () => {
    const c = detectCiContext({
      GITHUB_ACTIONS: "true",
      GITHUB_SHA: "deadbeef",
      GITHUB_REF_NAME: "feature/x",
    });
    expect(c.trigger).toBe("ci");
    expect(c.commit_sha).toBe("deadbeef");
    expect(c.branch).toBe("feature/x");
    expect(c.provider).toBe("github-actions");
  });

  it("detects GitLab CI", () => {
    const c = detectCiContext({
      GITLAB_CI: "true",
      CI_COMMIT_SHA: "abc123",
      CI_COMMIT_REF_NAME: "main",
    });
    expect(c.provider).toBe("gitlab-ci");
    expect(c.commit_sha).toBe("abc123");
    expect(c.branch).toBe("main");
  });

  it("detects CircleCI", () => {
    const c = detectCiContext({ CIRCLECI: "true", CIRCLE_SHA1: "x", CIRCLE_BRANCH: "y" });
    expect(c.provider).toBe("circleci");
    expect(c.commit_sha).toBe("x");
    expect(c.branch).toBe("y");
  });

  it("detects Jenkins via JENKINS_URL", () => {
    const c = detectCiContext({
      JENKINS_URL: "http://jenkins/",
      GIT_COMMIT: "j1",
      BRANCH_NAME: "release/1",
    });
    expect(c.provider).toBe("jenkins");
    expect(c.commit_sha).toBe("j1");
    expect(c.branch).toBe("release/1");
  });

  it("falls back to generic CI when only CI=true is set", () => {
    const c = detectCiContext({ CI: "true" });
    expect(c.trigger).toBe("ci");
    expect(c.provider).toBe("generic");
    expect(c.commit_sha).toBeNull();
  });

  it("ZOND_* overrides win over autodetection", () => {
    const c = detectCiContext({
      GITHUB_ACTIONS: "true",
      GITHUB_SHA: "from-github",
      ZOND_COMMIT_SHA: "override-sha",
      ZOND_BRANCH: "override-branch",
      ZOND_TRIGGER: "manual",
    });
    expect(c.commit_sha).toBe("override-sha");
    expect(c.branch).toBe("override-branch");
    expect(c.trigger).toBe("manual");
  });

  it("ZOND_TRIGGER must be ci|manual to take effect", () => {
    const c = detectCiContext({ CI: "true", ZOND_TRIGGER: "garbage" });
    expect(c.trigger).toBe("ci"); // autodetection still wins
  });
});
