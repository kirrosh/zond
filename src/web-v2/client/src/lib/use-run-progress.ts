// TASK-95 spike — production migration tracked separately
import { useEffect, useRef, useState } from "react";
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
  const closedCleanly = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setFrame(null);
    setDone(false);
    setError(null);
    closedCleanly.current = false;

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
      closedCleanly.current = true;
      setDone(true);
      es.close();
    });
    es.onerror = () => {
      // EventSource fires onerror on normal connection close too — only flag
      // a real error if we never received a 'done' event.
      if (closedCleanly.current) return;
      // CONNECTING means browser is auto-retrying; let it. Show error only on
      // a definitive close that wasn't preceded by a 'done' event.
      if (es.readyState === EventSource.CLOSED) {
        setError("connection lost");
      }
    };
    return () => {
      closedCleanly.current = true;
      es.close();
    };
  }, [runId, enabled]);

  return { frame, done, error };
}
