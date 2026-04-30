import { Badge } from "./ui/badge";
import type { FailureClass } from "../lib/api";

type Variant = "destructive" | "warning" | "secondary" | "info" | "muted";

interface ClassMeta {
  label: string;
  variant: Variant;
  /** Short hint shown in title when no failure_class_reason is available. */
  defaultHint: string;
}

const META: Record<FailureClass, ClassMeta> = {
  definitely_bug: {
    label: "definitely bug",
    variant: "destructive",
    defaultHint: "Spec contract violated — server crash, schema mismatch, or status not in spec",
  },
  likely_bug: {
    label: "likely bug",
    variant: "warning",
    defaultHint: "Heuristic match — API likely misbehaved (e.g. accepted invalid input)",
  },
  quirk: {
    label: "quirk",
    variant: "secondary",
    defaultHint: "Cosmetic / stylistic deviation, unlikely to affect callers",
  },
  env_issue: {
    label: "env issue",
    variant: "info",
    defaultHint: "Test setup problem (auth, network, missing fixtures) — not an API bug",
  },
};

interface FailureClassBadgeProps {
  failureClass: FailureClass | null;
  reason: string | null;
  className?: string;
}

export function FailureClassBadge({ failureClass, reason, className }: FailureClassBadgeProps) {
  if (failureClass === null) {
    return (
      <Badge
        variant="muted"
        className={className}
        title="No classification recorded for this failure (older run)."
      >
        unclassified
      </Badge>
    );
  }
  const meta = META[failureClass];
  return (
    <Badge variant={meta.variant} className={className} title={reason ?? meta.defaultHint}>
      {meta.label}
    </Badge>
  );
}
