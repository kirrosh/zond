// TASK-95 spike — production migration tracked separately
import { Link, useParams } from "@tanstack/react-router";

export function RunDetailPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-4">
      <Link
        to="/runs"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All runs
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Run {runId}</h1>
        <p className="text-sm text-muted-foreground">Detail view — placeholder.</p>
      </header>
      <div className="rounded-md border bg-muted p-6 text-sm text-muted-foreground">
        Stage 4c will render header meta + failures list + evidence panel.
      </div>
    </main>
  );
}
