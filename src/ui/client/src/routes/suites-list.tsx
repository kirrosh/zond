import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  suitesListQueryOptions,
  type SuiteEntry,
  type SuiteLastRun,
  type SuiteTestEntry,
} from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { cn } from "../lib/utils";

export type SuiteSourceFilter = "all" | "openapi-generated" | "manual" | "probe-suite";

const FILTER_OPTIONS: { value: SuiteSourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "openapi-generated", label: "OpenAPI" },
  { value: "probe-suite", label: "Probes" },
  { value: "manual", label: "Manual" },
];

function classifySuite(suite: SuiteEntry): SuiteSourceFilter {
  const t = suite.source?.type;
  if (t === "openapi-generated" || t === "probe-suite") return t;
  return "manual";
}

export function SuitesListPage() {
  const { source } = useSearch({ from: "/suites" });
  const navigate = useNavigate({ from: "/suites" });
  const { data } = useSuspenseQuery(suitesListQueryOptions());

  const filtered = source === "all"
    ? data.suites
    : data.suites.filter((s) => classifySuite(s) === source);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Suites</h1>
        <p className="text-sm text-muted-foreground">
          {data.suites.length} suite{data.suites.length === 1 ? "" : "s"} in workspace ·{" "}
          <span className="font-mono text-xs">{data.root}</span>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={source === opt.value ? "default" : "outline"}
            onClick={() => navigate({ search: { source: opt.value } })}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {data.errors.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>{data.errors.length}</strong> file{data.errors.length === 1 ? "" : "s"} failed to parse:
          <ul className="mt-1 space-y-0.5">
            {data.errors.slice(0, 5).map((e) => (
              <li key={e.file} className="font-mono">{e.file}: {e.error}</li>
            ))}
            {data.errors.length > 5 && <li>… and {data.errors.length - 5} more</li>}
          </ul>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-md border bg-muted p-6 text-sm text-muted-foreground">
          {data.suites.length === 0
            ? "No YAML suites found in this workspace."
            : "No suites match the current filter."}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((suite) => (
                <SuiteRow key={`${suite.file ?? suite.name}`} suite={suite} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}

function SuiteRow({ suite }: { suite: SuiteEntry }) {
  const [open, setOpen] = useState(false);
  const kind = classifySuite(suite);
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell>
          <ChevronRight
            className={cn("size-4 transition-transform", open && "rotate-90")}
          />
        </TableCell>
        <TableCell>
          <div className="text-sm font-medium">{suite.name}</div>
          {suite.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">{suite.description}</div>
          )}
        </TableCell>
        <TableCell>
          <SourceBadge kind={kind} suite={suite} />
        </TableCell>
        <TableCell className="text-right tabular-nums text-sm">{suite.step_count}</TableCell>
        <TableCell>
          <LastRunCell run={suite.last_run} />
        </TableCell>
        <TableCell className="font-mono text-[11px] text-muted-foreground truncate max-w-[260px]" title={suite.file ?? ""}>
          {suite.file ?? "—"}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell />
          <TableCell colSpan={5} className="py-3">
            <SuiteTestsList tests={suite.tests} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SourceBadge({ kind, suite }: { kind: SuiteSourceFilter; suite: SuiteEntry }) {
  if (kind === "manual") {
    return <Badge variant="outline">manual</Badge>;
  }
  return (
    <div className="space-y-0.5">
      <Badge variant="outline">{kind}</Badge>
      {suite.source?.endpoint && (
        <div className="font-mono text-[11px] text-muted-foreground">{suite.source.endpoint}</div>
      )}
    </div>
  );
}

function LastRunCell({ run }: { run: SuiteLastRun | null }) {
  if (!run) {
    return <span className="text-xs text-muted-foreground">never</span>;
  }
  const failed = run.failed > 0;
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: String(run.run_id) }}
      className="inline-flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Badge variant={failed ? "destructive" : "success"}>
        {failed ? `${run.failed}/${run.total} fail` : "pass"}
      </Badge>
      <span className="text-xs text-muted-foreground">#{run.run_id}</span>
    </Link>
  );
}

function SuiteTestsList({ tests }: { tests: SuiteTestEntry[] }) {
  if (tests.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No steps in this suite.</p>;
  }
  return (
    <ul className="space-y-1">
      {tests.map((t, i) => (
        <li key={i} className="flex items-center gap-3 text-xs">
          <Badge variant="secondary" className="font-mono uppercase">{t.method}</Badge>
          <span className="font-mono text-muted-foreground">{t.path}</span>
          <span className="truncate">{t.name}</span>
          {t.source?.response_branch && (
            <Badge variant="outline" className="ml-auto">→ {t.source.response_branch}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
