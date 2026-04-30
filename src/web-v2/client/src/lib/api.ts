// TASK-95 spike — production migration tracked separately
import { queryOptions } from "@tanstack/react-query";

export interface RunSummary {
  id: number;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  environment: string | null;
  duration_ms: number | null;
  collection_id: number | null;
}

export interface RunsListResponse {
  runs: RunSummary[];
  total: number;
  limit: number;
  offset: number;
}

export type StatusFilter = "all" | "passed" | "failed";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r.json() as Promise<T>;
}

export interface RunsQueryParams {
  status?: StatusFilter;
  limit?: number;
  offset?: number;
}

export function runsListQueryOptions(params: RunsQueryParams = {}) {
  const { status = "all", limit = 50, offset = 0 } = params;
  const search = new URLSearchParams();
  if (status !== "all") search.set("status", status);
  search.set("limit", String(limit));
  search.set("offset", String(offset));
  const url = `/api/runs?${search.toString()}`;
  return queryOptions({
    queryKey: ["runs", { status, limit, offset }] as const,
    queryFn: () => getJson<RunsListResponse>(url),
    staleTime: 5_000,
  });
}
