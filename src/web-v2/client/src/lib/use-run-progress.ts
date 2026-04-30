// TASK-95 spike — production migration tracked separately
import { useEffect, useState } from "react";
import type { ProgressFrame } from "./api";

interface UseRunProgressResult {
  frame: ProgressFrame | null;
  done: boolean;
  error: string | null;
}

export function useRunProgress(runId: string, enabled: boolean): UseRunProgressResult {
  const [frame, setFrame] = useState<ProgressFrame | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setFrame(null);
    setDone(false);
    setError(null);
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    const onFrame = (e: MessageEvent) => {
      try {
        setFrame(JSON.parse(e.data) as ProgressFrame);
      } catch {
        /* ignore malformed payloads */
      }
    };
    es.addEventListener("snapshot", onFrame);
    es.addEventListener("progress", onFrame);
    es.addEventListener("done", () => {
      setDone(true);
      es.close();
    });
    es.onerror = () => {
      setError("connection lost");
      es.close();
    };
    return () => es.close();
  }, [runId, enabled]);

  return { frame, done, error };
}
