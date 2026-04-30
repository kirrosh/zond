// TASK-95 spike — production migration tracked separately
export function RunsListPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          History of zond runs. Click a row to inspect failures and evidence.
        </p>
      </header>
      <div className="rounded-md border bg-muted p-6 text-sm text-muted-foreground">
        Stage 4a placeholder — table comes in 4b once <code>/api/runs</code> is wired.
      </div>
    </main>
  );
}
