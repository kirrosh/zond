// TASK-95 spike — production migration tracked separately
import { useEffect, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Button } from "./components/ui/button";

interface HelloPayload {
  message: string;
  bunVersion: string;
  ts: string;
}

export function App() {
  const [count, setCount] = useState(0);
  const [hello, setHello] = useState<HelloPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setHello(data as HelloPayload))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">zond v2 — spike</h1>
        <p className="text-sm text-muted-foreground">
          React 19 + Hono + Bun bundler + Tailwind 4 + shadcn. TASK-95 stage 3.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">HMR / state probe</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Counter:</span>
          <span className="text-2xl font-semibold tabular-nums">{count}</span>
          <Button onClick={() => setCount((c) => c + 1)}>
            <Plus className="size-4" />
            Increment
          </Button>
          <Button variant="outline" onClick={() => setCount(0)}>
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Edit this label, save, watch whether the counter value survives.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-medium">API probe</h2>
        {error ? (
          <p className="text-destructive text-sm">API error: {error}</p>
        ) : hello ? (
          <pre className="rounded-md border bg-muted p-3 text-xs overflow-x-auto">
{JSON.stringify(hello, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </section>
    </main>
  );
}
