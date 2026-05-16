import { describe, expect, test } from "bun:test";
import { placeholderAlias, pathWithByAliases, endpointStem } from "../../../src/core/probe/shared.ts";

describe("placeholderAlias (TASK-159)", () => {
  test("Sentry-style suffixes collapse to canonical short aliases", () => {
    expect(placeholderAlias("organization_id_or_slug")).toBe("org");
    expect(placeholderAlias("project_id_or_slug")).toBe("proj");
  });

  test("trailing _id / _slug / Id / Slug stripped", () => {
    expect(placeholderAlias("replay_id")).toBe("replay");
    expect(placeholderAlias("segment_id")).toBe("segment");
    expect(placeholderAlias("user_id")).toBe("user");
    expect(placeholderAlias("userId")).toBe("user");
    expect(placeholderAlias("repoSlug")).toBe("repo");
  });

  test("bare 'id' stays as 'id'", () => {
    expect(placeholderAlias("id")).toBe("id");
  });

  test("over-long names are capped at 12 chars", () => {
    const out = placeholderAlias("notification_subscription_id");
    expect(out.length).toBeLessThanOrEqual(12);
  });

  test("pathWithByAliases preserves identity per placeholder", () => {
    expect(pathWithByAliases("/organizations/{organization_id_or_slug}/projects/{project_id_or_slug}/replays/{replay_id}/segments/{segment_id}"))
      .toBe("/organizations/by-org/projects/by-proj/replays/by-replay/segments/by-segment");
  });

  test("endpointStem builds a distinguishable file stem", () => {
    const ep = {
      method: "GET",
      path: "/projects/{project_id_or_slug}/replays/{replay_id}/recording-segments/{segment_id}",
    } as any;
    const stem = endpointStem(ep);
    expect(stem).toBe("get-projects-by-proj-replays-by-replay-recording-segments-by-segment");
    // The old behavior would collapse to three by-id; the new one keeps each
    // placeholder distinguishable.
    expect(stem).not.toInclude("by-id-by-id");
  });
});
