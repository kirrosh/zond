import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import {
  runsListQueryOptions,
  sessionRunsQueryOptions,
  sessionsListQueryOptions,
  type RunSummary,
  type SessionSummary,
  type StatusFilter,
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

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
];

type RunsView = "sessions" | "runs";

export function RunsListPage() {
  const { status, view } = useSearch({ from: "/runs" });
  const navigate = useNavigate({ from: "/runs" });

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground">
            {view === "sessions"
              ? "Grouped by session — collapse multi-run campaigns into one row."
              : "Flat list of every run."}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-1">
          <Button
            size="sm"
            variant={view === "sessions" ? "default" : "ghost"}
            onClick={() => navigate({ search: { status, view: "sessions" } })}
          >
            Sessions
          </Button>
          <Button
            size="sm"
            variant={view === "runs" ? "default" : "ghost"}
            onClick={() => navigate({ search: { status, view: "runs" } })}
          >
            Runs
          </Button>
        </div>
      </header>

      {view === "sessions" ? (
        <SessionsView />
      ) : (
        <RunsView
          status={status}
          onStatusChange={(s) => navigate({ search: { status: s, view: "runs" } })}
        />
      )}
    </main>
  );
}

function SessionsView() {
  const { data } = useSuspenseQuery(sessionsListQueryOptions());

  if (data.sessions.length === 0) {
    return (
      <div className="rounded-md border bg-muted p-6 text-sm text-muted-foreground">
        No sessions yet. Pass <code className="font-mono">--session-id &lt;uuid&gt;</code> to{" "}
        <code className="font-mono">zond run</code> (or set{" "}
        <code className="font-mono">ZOND_SESSION_ID</code>) to group runs into a campaign.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Session</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Pass</TableHead>
            <TableHead className="text-right">Fail</TableHead>
            <TableHead className="text-right">Skip</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.sessions.map((s) => (
            <SessionRow key={s.session_id} session={s} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const [expanded, setExpanded] = useState(false);
  const failed = session.failed > 0;
  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <TableCell className="text-xs text-muted-foreground">{expanded ? "▾" : "▸"}</TableCell>
        <TableCell className="font-mono text-xs" title={session.session_id}>
          {session.session_id.slice(0, 8)}
        </TableCell>
        <TableCell className="text-xs">{formatDate(session.started_at)}</TableCell>
        <TableCell>
          <Badge variant={failed ? "destructive" : "success"}>{failed ? "FAIL" : "PASS"}</Badge>
        </TableCell>
        <TableCell className="text-right tabular-nums">{session.run_count}</TableCell>
        <TableCell className="text-right tabular-nums">{session.total}</TableCell>
        <TableCell className="text-right tabular-nums text-emerald-700">{session.passed}</TableCell>
        <TableCell className="text-right tabular-nums text-red-700">{session.failed}</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{session.skipped}</TableCell>
        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
          {formatDuration(session.duration_ms)}
        </TableCell>
      </TableRow>
      {expanded && <SessionExpanded sessionId={session.session_id} />}
    </>
  );
}

function SessionExpanded({ sessionId }: { sessionId: string }) {
  const { data, isPending, error } = useQuery(sessionRunsQueryOptions(sessionId));

  if (isPending) {
    return (
      <TableRow>
        <TableCell colSpan={10} className="text-xs text-muted-foreground">Loading…</TableCell>
      </TableRow>
    );
  }
  if (error || !data) {
    return (
      <TableRow>
        <TableCell colSpan={10} className="text-xs text-red-700">Failed to load runs.</TableCell>
      </TableRow>
    );
  }
  return (
    <>
      {data.runs.map((run) => (
        <TableRow key={run.id} className="bg-muted/30">
          <TableCell />
          <TableCell className="font-mono text-xs">
            <Link to="/runs/$runId" params={{ runId: String(run.id) }}>#{run.id}</Link>
          </TableCell>
          <TableCell className="text-xs">{formatDate(run.started_at)}</TableCell>
          <TableCell>
            <Badge variant={run.failed > 0 ? "destructive" : "success"}>
              {run.failed > 0 ? "FAIL" : "PASS"}
            </Badge>
          </TableCell>
          <TableCell />
          <TableCell className="text-right tabular-nums">{run.total}</TableCell>
          <TableCell className="text-right tabular-nums text-emerald-700">{run.passed}</TableCell>
          <TableCell className="text-right tabular-nums text-red-700">{run.failed}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">{run.skipped}</TableCell>
          <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
            {formatDuration(run.duration_ms)}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function RunsView({
  status,
  onStatusChange,
}: {
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
}) {
  const { data } = useSuspenseQuery(runsListQueryOptions({ status }));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="sm"
            variant={status === opt.value ? "default" : "outline"}
            onClick={() => onStatusChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {data.total} run{data.total === 1 ? "" : "s"} total
        </span>
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
                <TableHead>Session</TableHead>
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
    </div>
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
      <TableCell className="font-mono text-xs text-muted-foreground" title={run.session_id ?? ""}>
        {run.session_id ? run.session_id.slice(0, 8) : "—"}
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
