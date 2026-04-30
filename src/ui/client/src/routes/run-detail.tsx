import { Link, useParams } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, ChevronRight, Copy, Radio } from "lucide-react";
import {
  runDetailQueryOptions,
  type AssertionResult,
  type RunRecord,
  type StoredStepResult,
} from "../lib/api";
import { useRunProgress } from "../lib/use-run-progress";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

export function RunDetailPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const { data } = useSuspenseQuery(runDetailQueryOptions(runId));
  const { run, results } = data;
  const failures = results.filter((r) => r.status !== "pass");

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <Link
        to="/runs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← All runs
      </Link>

      <RunHeader run={run} failureCount={failures.length} totalCount={results.length} />

      <LiveProgressStrip runId={runId} total={Math.max(run.total, 1)} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Failures</h2>
          <span className="text-xs text-muted-foreground">
            {failures.length} of {results.length} step{results.length === 1 ? "" : "s"}
          </span>
        </div>
        {failures.length === 0 ? (
          <div className="rounded-md border bg-muted p-6 text-sm text-muted-foreground">
            All steps passed — nothing to investigate.
          </div>
        ) : (
          <ul className="space-y-2">
            {failures.map((step) => (
              <FailureCard key={step.id} step={step} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function LiveProgressStrip({ runId, total }: { runId: string; total: number }) {
  // Spike: server always emits a fake ramp-up so the SSE wiring is observable.
  // Production would auto-start only for runs with finished_at === null.
  const [open, setOpen] = useState(false);
  const { frame, done, error } = useRunProgress(runId, open);

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Radio className="size-3.5" />
          SSE live progress (spike stub)
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Replay progress
        </Button>
      </div>
    );
  }

  const completed = frame?.completed ?? 0;
  const target = frame?.total ?? total;
  const pct = target > 0 ? Math.round((completed / target) * 100) : 0;

  return (
    <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2">
          <Radio className={cn("size-3.5", !done && "animate-pulse text-emerald-600")} />
          {done ? "Done" : "Streaming progress…"}
        </span>
        <span className="font-mono tabular-nums">
          {completed} / {target} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-background">
        <div
          className={cn("h-full transition-[width] duration-200", done ? "bg-emerald-500" : "bg-foreground/70")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {error && <p className="text-destructive">SSE error: {error}</p>}
    </div>
  );
}

function RunHeader({
  run,
  failureCount,
  totalCount,
}: {
  run: RunRecord;
  failureCount: number;
  totalCount: number;
}) {
  const overallFailed = run.failed > 0;
  return (
    <header className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Run #{run.id}</h1>
        <Badge variant={overallFailed ? "destructive" : "success"}>
          {overallFailed ? "FAIL" : "PASS"}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
        <Meta label="Started" value={formatDate(run.started_at)} />
        <Meta label="Finished" value={run.finished_at ? formatDate(run.finished_at) : "—"} />
        <Meta label="Duration" value={formatDuration(run.duration_ms)} />
        <Meta label="Trigger" value={run.trigger} />
        <Meta label="Total" value={String(totalCount)} />
        <Meta label="Passed" value={String(run.passed)} />
        <Meta label="Failed" value={String(failureCount)} />
        <Meta label="Skipped" value={String(run.skipped)} />
        <Meta label="Branch" value={run.branch ?? "—"} />
        <Meta label="Commit" value={run.commit_sha ? run.commit_sha.slice(0, 8) : "—"} />
        <Meta className="col-span-2" label="Environment" value={run.environment ?? "—"} mono />
      </dl>
    </header>
  );
}

function Meta({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm", mono && "font-mono text-xs break-all")}>{value}</dd>
    </div>
  );
}

function FailureCard({ step }: { step: StoredStepResult }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {step.request_method ?? "—"}
        </span>
        <span className="truncate text-sm">{step.test_name}</span>
        <Badge variant="outline" className="ml-auto">
          {step.response_status ?? "no resp"}
        </Badge>
        <Badge variant={step.status === "pass" ? "success" : "destructive"}>
          {step.status}
        </Badge>
      </button>
      {open && <EvidencePanel step={step} />}
    </li>
  );
}

type EvidenceTab = "request" | "response" | "assertions";

function EvidencePanel({ step }: { step: StoredStepResult }) {
  const [tab, setTab] = useState<EvidenceTab>("response");
  const tabs: { id: EvidenceTab; label: string }[] = [
    { id: "request", label: "Request" },
    { id: "response", label: "Response" },
    { id: "assertions", label: `Assertions (${step.assertions.length})` },
  ];
  return (
    <div className="border-t bg-muted/20">
      <div className="flex items-center justify-between border-b px-3">
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-2 text-xs font-medium transition-colors",
                tab === t.id
                  ? "border-b-2 border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <CopyCurlButton step={step} />
      </div>
      <div className="p-3">
        {tab === "request" && <RequestPanel step={step} />}
        {tab === "response" && <ResponsePanel step={step} />}
        {tab === "assertions" && <AssertionsPanel assertions={step.assertions} />}
      </div>
    </div>
  );
}

function RequestPanel({ step }: { step: StoredStepResult }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-xs">
        <span className="text-muted-foreground">{step.request_method ?? "—"}</span>{" "}
        <span className="break-all">{step.request_url ?? "—"}</span>
      </div>
      <CodeBlock title="Body" content={step.request_body} />
    </div>
  );
}

function ResponsePanel({ step }: { step: StoredStepResult }) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-xs">
        Status: <strong>{step.response_status ?? "—"}</strong>
      </div>
      {step.error_message && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          {step.error_message}
        </div>
      )}
      <CodeBlock title="Headers" content={step.response_headers} />
      <CodeBlock title="Body" content={step.response_body} />
    </div>
  );
}

function AssertionsPanel({ assertions }: { assertions: AssertionResult[] }) {
  if (assertions.length === 0) {
    return <p className="text-xs text-muted-foreground">No assertions recorded.</p>;
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {assertions.map((a, i) => (
        <li
          key={i}
          className={cn(
            "rounded border px-2 py-1.5",
            a.passed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
          )}
        >
          <div className="flex items-center gap-2">
            <Badge variant={a.passed ? "success" : "destructive"}>{a.type}</Badge>
            {a.path && <span className="font-mono text-muted-foreground">{a.path}</span>}
          </div>
          {a.message && <div className="mt-1 text-muted-foreground">{a.message}</div>}
          {!a.passed && (a.expected !== undefined || a.actual !== undefined) && (
            <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div>
                <span className="text-muted-foreground">expected: </span>
                <span>{prettyValue(a.expected)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">actual: </span>
                <span>{prettyValue(a.actual)}</span>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function CodeBlock({ title, content }: { title: string; content: string | null }) {
  if (!content) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-xs text-muted-foreground italic">empty</div>
      </div>
    );
  }
  const pretty = tryPrettyJson(content);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <pre className="mt-1 max-h-72 overflow-auto rounded bg-background p-2 text-[11px] font-mono leading-relaxed">
        {pretty}
      </pre>
    </div>
  );
}

function CopyCurlButton({ step }: { step: StoredStepResult }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const curl = buildCurl(step);
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <Button size="sm" variant="ghost" onClick={onCopy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy curl"}
    </Button>
  );
}

function buildCurl(step: StoredStepResult): string {
  const parts: string[] = ["curl"];
  if (step.request_method && step.request_method.toUpperCase() !== "GET") {
    parts.push("-X", step.request_method.toUpperCase());
  }
  if (step.request_body) {
    const single = step.request_body.replace(/'/g, "'\\''");
    parts.push("-d", `'${single}'`);
    parts.push("-H", "'Content-Type: application/json'");
  }
  parts.push(`'${step.request_url ?? ""}'`);
  return parts.join(" ");
}

function tryPrettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function prettyValue(v: unknown): string {
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
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
