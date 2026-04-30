// TASK-95 spike — production migration tracked separately
import { useEffect, useState } from "react";

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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 720 }}>
      <h1>zond v2 — spike</h1>
      <p>React 19  ВВВы + Hono + Bun bundler. TASK-95.</p>

      <section style={{ marginTop: 24 }}>
        <h2>HMR / state probe</h2>
        <p>
          Counter: <strong>{count}</strong>{" "}
          <button onClick={() => setCount((c) => c + 1)}>+1</button>
        </p>
        <p style={{ color: "#666" }}>
          Edit this label, save, and watch whether the counter resets — that probes Fast Refresh.
        </p>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>API probe</h2>
        {error ? (
          <p style={{ color: "crimson" }}>API error: {error}</p>
        ) : hello ? (
          <pre style={{ background: "#f4f4f5", padding: 12, borderRadius: 6 }}>
{JSON.stringify(hello, null, 2)}
          </pre>
        ) : (
          <p>Loading…</p>
        )}
      </section>
    </main>
  );
}
