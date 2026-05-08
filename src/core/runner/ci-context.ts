/**
 * TASK-116: detect CI context (commit sha, branch, trigger) from common
 * environment variables. Returns `null` for fields when nothing is present
 * — caller decides whether to default `trigger` to `"manual"`.
 *
 * Supported providers (autodetected — no opt-in required):
 *   GitHub Actions  GITHUB_ACTIONS=true, GITHUB_SHA, GITHUB_REF_NAME
 *   GitLab CI       GITLAB_CI=true, CI_COMMIT_SHA, CI_COMMIT_REF_NAME
 *   CircleCI        CIRCLECI=true, CIRCLE_SHA1, CIRCLE_BRANCH
 *   Buildkite       BUILDKITE=true, BUILDKITE_COMMIT, BUILDKITE_BRANCH
 *   Jenkins         JENKINS_URL set, GIT_COMMIT, BRANCH_NAME / GIT_BRANCH
 *   Generic         CI=true triggers `trigger=ci` even when no provider
 *                   matches — caller can still pass nullable commit/branch.
 *
 * Manual override is via the explicit `--commit-sha` / `--branch` /
 * `--trigger` flags or the env vars `ZOND_COMMIT_SHA` / `ZOND_BRANCH` /
 * `ZOND_TRIGGER`. These win over autodetection.
 */
export interface CiContext {
  trigger: "ci" | "manual";
  commit_sha: string | null;
  branch: string | null;
  /** Provider tag (github-actions / gitlab-ci / circleci / …) for diagnostics. */
  provider: string | null;
}

export function detectCiContext(env: NodeJS.ProcessEnv = process.env): CiContext {
  const overrideCommit = env.ZOND_COMMIT_SHA?.trim() || null;
  const overrideBranch = env.ZOND_BRANCH?.trim() || null;
  const overrideTrigger = env.ZOND_TRIGGER?.trim() || null;

  let provider: string | null = null;
  let commit: string | null = null;
  let branch: string | null = null;

  if (env.GITHUB_ACTIONS === "true") {
    provider = "github-actions";
    commit = env.GITHUB_SHA?.trim() || null;
    branch = env.GITHUB_REF_NAME?.trim() || env.GITHUB_HEAD_REF?.trim() || null;
  } else if (env.GITLAB_CI === "true") {
    provider = "gitlab-ci";
    commit = env.CI_COMMIT_SHA?.trim() || null;
    branch = env.CI_COMMIT_REF_NAME?.trim() || null;
  } else if (env.CIRCLECI === "true") {
    provider = "circleci";
    commit = env.CIRCLE_SHA1?.trim() || null;
    branch = env.CIRCLE_BRANCH?.trim() || null;
  } else if (env.BUILDKITE === "true") {
    provider = "buildkite";
    commit = env.BUILDKITE_COMMIT?.trim() || null;
    branch = env.BUILDKITE_BRANCH?.trim() || null;
  } else if (env.JENKINS_URL) {
    provider = "jenkins";
    commit = env.GIT_COMMIT?.trim() || null;
    branch = env.BRANCH_NAME?.trim() || env.GIT_BRANCH?.trim() || null;
  }

  const inferredCi = !!provider || env.CI === "true" || env.CI === "1";
  const trigger: "ci" | "manual" =
    overrideTrigger === "ci" || overrideTrigger === "manual"
      ? overrideTrigger
      : inferredCi
        ? "ci"
        : "manual";

  return {
    trigger,
    commit_sha: overrideCommit ?? commit,
    branch: overrideBranch ?? branch,
    provider: provider ?? (inferredCi ? "generic" : null),
  };
}
