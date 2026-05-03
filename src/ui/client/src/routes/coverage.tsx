import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  apisListQueryOptions,
  coverageQueryOptions,
  type CoverageCell,
  type CoverageReason,
  type CoverageRow,
  type CoverageStatusClass,
} from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

const STATUS_CLASSES: CoverageStatusClass[] = ["2xx", "4xx", "5xx"];

const REASON_LABEL: Record<CoverageReason, string> = {
  "covered": "covered",
  "partial-failed": "partial: had failing run",
  "not-generated": "not generated",
  "no-spec": "not in spec",
  "deprecated": "deprecated",
  "no-fixtures": "missing fixtures",
  "ephemeral-only": "ephemeral-only",
  "auth-scope-mismatch": "no auth token",
  "tag-filtered": "filtered out",
};

const REASON_HELP: Record<CoverageReason, string> = {
  "covered": "At least one passing step hit this status class.",
  "partial-failed": "Steps hit this status class but only failing ones — investigate and re-run.",
  "not-generated": "No suite covers this endpoint × status. Run `zond generate` or write one manually.",
  "no-spec": "Status class isn't declared in the OpenAPI spec for this endpoint.",
  "deprecated": "Endpoint is marked deprecated in the spec.",
  "no-fixtures": "Path-param env vars are missing in `.env.yaml` — generated suites would skip.",
  "ephemeral-only": "Endpoint is only covered by ephemeral suites; current profile excludes them.",
  "auth-scope-mismatch": "Endpoint requires an auth scheme with no configured token in `.env.yaml`.",
  "tag-filtered": "Endpoint tags don't intersect the active tag filter.",
};

interface CoverageSearch {
  api?: string;
  runId?: number;
  profile?: "safe" | "full";
  tag?: string;
}

export const validateCoverageSearch = (search: Record<string, unknown>): CoverageSearch => {
  const out: CoverageSearch = {};
  if (typeof search.api === "string") out.api = search.api;
  if (search.runId != null) {
    const n = Number(search.runId);
    if (Number.isFinite(n)) out.runId = n;
  }
  if (search.profile === "safe" || search.profile === "full") out.profile = search.profile;
  if (typeof search.tag === "string") out.tag = search.tag;
  return out;
};

export function CoveragePage() {
  const search = useSearch({ from: "/coverage" });
  const navigate = useNavigate();
  const apis = useSuspenseQuery(apisListQueryOptions());
  const apiName = search.api ?? apis.data.current ?? apis.data.apis[0]?.name ?? null;

  if (!apiName) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-lg font-semibold">Coverage</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          No registered APIs yet. Run <code className="rounded bg-muted px-1">zond add api --spec &lt;path&gt;</code> to register one.
        </p>
      </main>
    );
  }

  const tagList = search.tag ? search.tag.split(",").filter(Boolean) : [];
  const coverage = useQuery(coverageQueryOptions({
    api: apiName,
    ...(search.runId != null ? { runId: search.runId } : {}),
    profile: search.profile ?? "full",
    tag: tagList,
  }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Coverage</h1>
        <ApiPicker
          current={apiName}
          options={apis.data.apis.map((a) => a.name)}
          onChange={(name) => navigate({ to: "/coverage", search: { ...search, api: name } })}
        />
      </div>

      <FilterBar
        profile={search.profile ?? "full"}
        tagList={tagList}
        availableTags={collectTags(coverage.data?.matrix.rows ?? [])}
        onProfileChange={(p) => navigate({ to: "/coverage", search: { ...search, profile: p } })}
        onTagChange={(tags) =>
          navigate({ to: "/coverage", search: { ...search, tag: tags.length > 0 ? tags.join(",") : undefined } })
        }
      />

      {coverage.isLoading && <div className="text-sm text-muted-foreground">Loading coverage…</div>}
      {coverage.error && (
        <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {(coverage.error as Error).message}
        </div>
      )}
      {coverage.data && <CoverageView data={coverage.data} />}
    </main>
  );
}

function ApiPicker({ current, options, onChange }: { current: string; options: string[]; onChange: (s: string) => void }) {
  if (options.length <= 1) {
    return <span className="text-xs font-mono text-muted-foreground">{current}</span>;
  }
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border bg-background px-2 py-1 font-mono text-xs"
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function FilterBar({
  profile, tagList, availableTags, onProfileChange, onTagChange,
}: {
  profile: "safe" | "full";
  tagList: string[];
  availableTags: string[];
  onProfileChange: (p: "safe" | "full") => void;
  onTagChange: (tags: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border bg-muted/20 px-3 py-2 text-xs">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Profile:</span>
        <button
          onClick={() => onProfileChange("full")}
          className={cn("rounded px-2 py-0.5", profile === "full" ? "bg-foreground text-background" : "bg-background border")}
        >
          full
        </button>
        <button
          onClick={() => onProfileChange("safe")}
          className={cn("rounded px-2 py-0.5", profile === "safe" ? "bg-foreground text-background" : "bg-background border")}
        >
          safe (no ephemeral)
        </button>
      </div>
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">Tags:</span>
          {availableTags.map((t) => {
            const active = tagList.includes(t);
            return (
              <button
                key={t}
                onClick={() => onTagChange(active ? tagList.filter((x) => x !== t) : [...tagList, t])}
                className={cn("rounded px-2 py-0.5 font-mono", active ? "bg-foreground text-background" : "bg-background border")}
              >
                {t}
              </button>
            );
          })}
          {tagList.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onTagChange([])}>clear</Button>
          )}
        </div>
      )}
    </div>
  );
}

function collectTags(rows: CoverageRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const t of r.tags) set.add(t);
  return [...set].sort();
}

function CoverageView({ data }: { data: import("../lib/api").CoverageResponse }) {
  const [selected, setSelected] = useState<{ row: CoverageRow; cls: CoverageStatusClass } | null>(null);
  const totals = data.matrix.totals;
  const summary = useMemo(() => {
    const pct = totals.cells === 0 ? 0 : Math.round((totals.covered / totals.cells) * 1000) / 10;
    return { pct };
  }, [totals]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <SummaryStrip totals={totals} pct={summary.pct} runId={data.run?.id ?? null} />
        <div className="overflow-hidden rounded border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                {STATUS_CLASSES.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matrix.rows.map((row) => (
                <tr key={row.endpoint} className="border-t">
                  <td className="px-3 py-1.5 align-top">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="font-mono">{row.method}</Badge>
                      <span className="font-mono">{row.path}</span>
                      {row.deprecated && <Badge variant="warning">deprecated</Badge>}
                      {row.tags.map((t) => <Badge key={t} variant="muted">{t}</Badge>)}
                    </div>
                  </td>
                  {STATUS_CLASSES.map((cls) => (
                    <td key={cls} className="px-2 py-1.5 align-top">
                      <CellView cell={row.cells[cls]} onClick={() => setSelected({ row, cls })} active={selected?.row.endpoint === row.endpoint && selected?.cls === cls} />
                    </td>
                  ))}
                </tr>
              ))}
              {data.matrix.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No endpoints in spec.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <DrillDown selected={selected} />
    </div>
  );
}

function SummaryStrip({ totals, pct, runId }: { totals: import("../lib/api").CoverageTotals; pct: number; runId: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border bg-background px-3 py-2 text-xs">
      <span><strong>{pct}%</strong> covered</span>
      <span className="text-emerald-700">{totals.covered} ✓</span>
      <span className="text-amber-700">{totals.partial} partial</span>
      <span className="text-muted-foreground">{totals.uncovered} uncovered</span>
      <span className="text-muted-foreground">· {totals.endpoints} endpoints × 3 classes</span>
      {runId != null && (
        <Link to="/runs/$runId" params={{ runId: String(runId) }} className="ml-auto text-xs underline-offset-2 hover:underline">
          Run #{runId} →
        </Link>
      )}
    </div>
  );
}

function CellView({ cell, onClick, active }: { cell: CoverageCell; onClick: () => void; active: boolean }) {
  const bg =
    cell.status === "covered" ? "bg-emerald-100 hover:bg-emerald-200"
    : cell.status === "partial" ? "bg-amber-100 hover:bg-amber-200"
    : "bg-muted hover:bg-muted/80";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full flex-wrap items-center gap-1 rounded px-2 py-1.5 text-left transition-colors",
        bg,
        active && "ring-2 ring-foreground/40",
      )}
    >
      {cell.reasons.map((r, i) => (
        <span key={i} className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px]">
          {REASON_LABEL[r]}
        </span>
      ))}
    </button>
  );
}

function DrillDown({ selected }: { selected: { row: CoverageRow; cls: CoverageStatusClass } | null }) {
  if (!selected) {
    return (
      <aside className="rounded border bg-muted/10 p-3 text-xs text-muted-foreground">
        Click a cell to inspect why and which steps cover it.
      </aside>
    );
  }
  const { row, cls } = selected;
  const cell = row.cells[cls];
  return (
    <aside className="space-y-3 rounded border bg-background p-3 text-xs">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Endpoint × class</div>
        <div className="font-mono">{row.method} {row.path} · {cls}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Reasons</div>
        <ul className="mt-1 space-y-1.5">
          {cell.reasons.map((r) => (
            <li key={r} className="rounded border bg-muted/20 px-2 py-1">
              <div className="font-mono text-[11px]">{REASON_LABEL[r]}</div>
              <div className="text-[11px] text-muted-foreground">{REASON_HELP[r]}</div>
            </li>
          ))}
        </ul>
      </div>
      {row.declaredStatuses.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Declared in spec</div>
          <div className="mt-1 font-mono text-[11px]">{row.declaredStatuses.join(", ")}</div>
        </div>
      )}
      {row.security.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Security</div>
          <div className="mt-1 font-mono text-[11px]">{row.security.join(", ")}</div>
        </div>
      )}
      {cell.results.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Steps ({cell.results.length})</div>
          <ul className="mt-1 space-y-1">
            {cell.results.map((r) => (
              <li key={r.resultId} className="rounded border bg-muted/20 px-2 py-1">
                <Link to="/runs/$runId" params={{ runId: String(r.runId) }} className="font-mono text-[11px] underline-offset-2 hover:underline">
                  Run #{r.runId} · {r.testName}
                </Link>
                <div className="text-[10px] text-muted-foreground">
                  {r.responseStatus ?? "—"} · {r.status}{r.failureClass ? ` · ${r.failureClass}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
