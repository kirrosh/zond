// TASK-95 spike — production migration tracked separately
// Code-based router (not file-based) — simpler for spike, no codegen step.
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { RunsListPage } from "./routes/runs-list";
import { RunDetailPage } from "./routes/run-detail";

const rootRoute = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <span className="text-sm font-semibold">zond v2</span>
          <Link
            to="/runs"
            activeProps={{ className: "text-foreground" }}
            inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
            className="text-sm transition-colors"
          >
            Runs
          </Link>
          <span className="ml-auto text-xs text-muted-foreground">spike · TASK-95</span>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/runs" });
  },
});

const runsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  component: RunsListPage,
});

const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: RunDetailPage,
});

const routeTree = rootRoute.addChildren([indexRoute, runsListRoute, runDetailRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
