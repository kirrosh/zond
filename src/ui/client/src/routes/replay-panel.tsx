import { useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";
import { Check, Copy, Plus, Send, Trash2 } from "lucide-react";
import { postReplay, type ReplayResolved, type ReplayResponseBody, type StoredStepResult } from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

interface Draft {
  method: string;
  url: string;
  headers: HeaderRow[];
  body: string;
}

interface ReplayEntry {
  ts: number;
  draft: Draft;
  response?: ReplayResponseBody;
  error?: string;
}

function newId(): string {
  return Math.random().toString(36).slice(2);
}

function tryParseHeaders(raw: string | null): HeaderRow[] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({
        id: newId(),
        key: k,
        value: typeof v === "string" ? v : String(v),
      }));
    }
  } catch {
    // raw response_headers stored as string — best effort
  }
  return [];
}

function initFromStep(step: StoredStepResult): Draft {
  return {
    method: (step.request_method ?? "GET").toUpperCase(),
    url: step.request_url ?? "",
    // Stored step has no request_headers; if body is JSON the runner sets Content-Type
    // automatically so we leave headers blank by default.
    headers: [],
    body: step.request_body ?? "",
  };
}

function headersToObject(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    out[k] = r.value;
  }
  return out;
}

function diffSummary(original: Draft, current: Draft): string[] {
  const changes: string[] = [];
  if (original.method !== current.method) {
    changes.push(`method: ${original.method} → ${current.method}`);
  }
  if (original.url !== current.url) {
    changes.push("url changed");
  }
  const oh = headersToObject(original.headers);
  const ch = headersToObject(current.headers);
  const allKeys = new Set([...Object.keys(oh), ...Object.keys(ch)]);
  for (const k of allKeys) {
    if (oh[k] === ch[k]) continue;
    if (oh[k] === undefined) changes.push(`header +${k}`);
    else if (ch[k] === undefined) changes.push(`header −${k}`);
    else changes.push(`header ~${k}`);
  }
  if (original.body !== current.body) {
    const oLines = original.body ? original.body.split("\n").length : 0;
    const cLines = current.body ? current.body.split("\n").length : 0;
    changes.push(`body changed (${oLines} → ${cLines} lines)`);
  }
  return changes;
}

function isJson(body: string): boolean {
  if (!body.trim()) return false;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

export function ReplayPanel({ step }: { step: StoredStepResult }) {
  const original = useMemo(() => initFromStep(step), [step]);
  const [draft, setDraft] = useState<Draft>(original);
  const [history, setHistory] = useState<ReplayEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<ReplayResolved | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [yamlState, setYamlState] = useState<"idle" | "copied" | "error">("idle");

  const lastResponse = history[0]?.response;
  const lastError = history[0]?.error;

  // Debounced dryRun → resolved URL preview.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await postReplay({
          method: draft.method,
          url: draft.url || "http://placeholder",
          headers: headersToObject(draft.headers),
          body: draft.body || undefined,
          resultId: step.id,
          dryRun: true,
        });
        if (r.resolved) {
          setResolved(r.resolved);
          setResolveErr(null);
        } else if (r.error) {
          setResolveErr(r.error);
        }
      } catch (err) {
        setResolveErr(err instanceof Error ? err.message : String(err));
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, step.id]);

  const onSend = async () => {
    if (!draft.url.trim() || busy) return;
    setBusy(true);
    try {
      const r = await postReplay({
        method: draft.method,
        url: draft.url,
        headers: headersToObject(draft.headers),
        body: draft.body || undefined,
        resultId: step.id,
      });
      const entry: ReplayEntry = {
        ts: Date.now(),
        draft: { ...draft, headers: draft.headers.map((h) => ({ ...h })) },
        ...(r.response ? { response: r.response } : {}),
        ...(r.error ? { error: r.error } : {}),
      };
      setHistory((h) => [entry, ...h].slice(0, 20));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHistory((h) => [
        { ts: Date.now(), draft: { ...draft, headers: draft.headers.map((x) => ({ ...x })) }, error: msg },
        ...h,
      ].slice(0, 20));
    } finally {
      setBusy(false);
    }
  };

  const onSaveYaml = async () => {
    const headersObj = headersToObject(draft.headers);
    const yamlObj: Record<string, unknown> = {
      name: `Replay of ${step.test_name}`,
      method: draft.method,
      path: resolved?.url ?? draft.url,
    };
    if (Object.keys(headersObj).length > 0) yamlObj.headers = headersObj;
    if (draft.body.trim()) {
      try {
        yamlObj.json = JSON.parse(draft.body);
      } catch {
        yamlObj.body = draft.body;
      }
    }
    yamlObj.expect = { status: lastResponse?.status ?? 200 };
    const text = "- " + YAML.stringify(yamlObj).split("\n").join("\n  ").trimEnd() + "\n";
    try {
      await navigator.clipboard.writeText(text);
      setYamlState("copied");
      setTimeout(() => setYamlState("idle"), 1500);
    } catch {
      setYamlState("error");
      setTimeout(() => setYamlState("idle"), 1500);
    }
  };

  const changes = diffSummary(original, draft);
  const bodyJson = isJson(draft.body);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <select
          value={draft.method}
          onChange={(e) => setDraft({ ...draft, method: e.target.value })}
          className="rounded border bg-background px-2 py-1 font-mono"
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="https://api.example.com/users/{{user_id}}"
          className="flex-1 rounded border bg-background px-2 py-1 font-mono"
        />
        <Button size="sm" onClick={onSend} disabled={busy || !draft.url.trim()}>
          <Send className="size-3.5" />
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>

      {(resolved || resolveErr) && (
        <div className="rounded border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {resolveErr
            ? <span className="text-destructive">resolve error: {resolveErr}</span>
            : (
              <>
                <span className="text-[10px] uppercase tracking-wide">Resolved:</span>{" "}
                <span className="break-all">{resolved?.url}</span>
              </>
            )}
        </div>
      )}

      <HeadersEditor rows={draft.headers} onChange={(headers) => setDraft({ ...draft, headers })} />

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Body</div>
          {draft.body.trim() && (
            <Badge variant={bodyJson ? "success" : "muted"}>
              {bodyJson ? "JSON detected" : "raw text"}
            </Badge>
          )}
        </div>
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          rows={6}
          placeholder='{"name": "{{$randomName}}"}'
          className="w-full rounded border bg-background p-2 font-mono text-[11px] leading-relaxed"
        />
      </div>

      {changes.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-amber-700">
            Diff vs original ({changes.length})
          </div>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-amber-900">
            {changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onSaveYaml} disabled={!draft.url.trim()}>
          {yamlState === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {yamlState === "copied" ? "YAML copied" : yamlState === "error" ? "Copy failed" : "Save as YAML step"}
        </Button>
        {history.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setHistory([])}>
            <Trash2 className="size-3.5" />
            Clear history
          </Button>
        )}
      </div>

      {(lastResponse || lastError) && (
        <ResponseView response={lastResponse} error={lastError} />
      )}

      {history.length > 1 && (
        <HistoryList history={history.slice(1)} onRestore={(d) => setDraft(d)} />
      )}
    </div>
  );
}

function HeadersEditor({ rows, onChange }: { rows: HeaderRow[]; onChange: (rows: HeaderRow[]) => void }) {
  const update = (id: string, patch: Partial<HeaderRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const add = () => onChange([...rows, { id: newId(), key: "", value: "" }]);
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Headers</div>
      {rows.length === 0 && (
        <div className="text-[11px] italic text-muted-foreground">
          No headers — Content-Type is auto-detected for JSON bodies.
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-1">
          <input
            value={r.key}
            onChange={(e) => update(r.id, { key: e.target.value })}
            placeholder="Header"
            className="w-44 rounded border bg-background px-2 py-1 font-mono text-[11px]"
          />
          <input
            value={r.value}
            onChange={(e) => update(r.id, { value: e.target.value })}
            placeholder="value"
            className="flex-1 rounded border bg-background px-2 py-1 font-mono text-[11px]"
          />
          <Button size="sm" variant="ghost" onClick={() => remove(r.id)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={add}>
        <Plus className="size-3.5" />
        Add header
      </Button>
    </div>
  );
}

function ResponseView({ response, error }: { response?: ReplayResponseBody; error?: string }) {
  if (error) {
    return (
      <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
        {error}
      </div>
    );
  }
  if (!response) return null;
  const ok = response.status >= 200 && response.status < 300;
  const bodyStr = typeof response.body === "string"
    ? response.body
    : JSON.stringify(response.body, null, 2);
  return (
    <div className="space-y-2 rounded border bg-background p-2">
      <div className="flex items-center gap-2 font-mono">
        <Badge variant={ok ? "success" : "destructive"}>{response.status}</Badge>
        <span className="text-muted-foreground">{response.duration_ms} ms</span>
      </div>
      <details>
        <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-muted-foreground">
          Headers ({Object.keys(response.headers).length})
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/30 p-2 text-[11px]">
          {JSON.stringify(response.headers, null, 2)}
        </pre>
      </details>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Body</div>
        <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-[11px] leading-relaxed">
          {bodyStr || "(empty)"}
        </pre>
      </div>
    </div>
  );
}

function HistoryList({ history, onRestore }: { history: ReplayEntry[]; onRestore: (d: Draft) => void }) {
  return (
    <details className="rounded border">
      <summary className="cursor-pointer px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        History ({history.length})
      </summary>
      <ul className="divide-y">
        {history.map((e) => (
          <li key={e.ts} className="flex items-center gap-2 px-2 py-1 font-mono text-[11px]">
            <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
            <span>{e.draft.method}</span>
            <span className="flex-1 truncate">{e.draft.url}</span>
            {e.response && (
              <Badge variant={e.response.status < 400 ? "success" : "destructive"}>
                {e.response.status}
              </Badge>
            )}
            {e.error && <Badge variant="destructive">err</Badge>}
            <Button size="sm" variant="ghost" onClick={() => onRestore(e.draft)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

