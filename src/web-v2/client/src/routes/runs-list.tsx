// TASK-95 spike — production migration tracked separately
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { runsListQueryOptions, type RunSummary, type StatusFilter } from "../lib/api";
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

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
];

export function RunsListPage() {
  const { status } = useSearch({ from: "/runs" });
  const navigate = useNavigate({ from: "/runs" });
  const { data } = useSuspenseQuery(runsListQueryOptions({ status }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          {data.total} run{data.total === 1 ? "" : "s"} total · click row to inspect.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={status === opt.value ? "default" : "outline"}
            onClick={() => navigate({ search: { status: opt.value } })}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      {data.runs.length === 0 ? (
        <div className="rounded-md border bg-muted p-6 text-sm text-muted-foreground">
          No runs match the current filter.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Pass</TableHead>
                <TableHead className="text-right">Fail</TableHead>
                <TableHead className="text-right">Skip</TableHead>
                <TableHead>Env</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}

function RunRow({ run }: { run: RunSummary }) {
  const overallFailed = run.failed > 0;
  return (
    <TableRow className="cursor-pointer">
      <TableCell className="font-mono text-xs">
        <Link to="/runs/$runId" params={{ runId: String(run.id) }}>
          #{run.id}
        </Link>
      </TableCell>
      <TableCell className="text-xs">
        <Link to="/runs/$runId" params={{ runId: String(run.id) }}>
          {formatDate(run.started_at)}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={overallFailed ? "destructive" : "success"}>
          {overallFailed ? "FAIL" : "PASS"}
        </Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">{run.total}</TableCell>
      <TableCell className="text-right tabular-nums text-emerald-700">{run.passed}</TableCell>
      <TableCell className="text-right tabular-nums text-red-700">{run.failed}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{run.skipped}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{run.environment ?? "—"}</TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(run.duration_ms)}
      </TableCell>
    </TableRow>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
