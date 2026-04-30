// Code-based router (not file-based) — simpler for spike, no codegen step.
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Suspense } from "react";
import { RunsListPage } from "./routes/runs-list";
import { RunDetailPage } from "./routes/run-detail";
import { SuitesListPage, type SuiteSourceFilter } from "./routes/suites-list";
import { runDetailQueryOptions, runsListQueryOptions, sessionsListQueryOptions, suitesListQueryOptions, type StatusFilter } from "./lib/api";

export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <span className="text-sm font-semibold">zond</span>
          <Link
            to="/runs"
            activeProps={{ className: "text-foreground" }}
            inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
            className="text-sm transition-colors"
          >
            Runs
          </Link>
          <Link
            to="/suites"
            activeProps={{ className: "text-foreground" }}
            inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
            className="text-sm transition-colors"
          >
            Suites
          </Link>
        </nav>
      </header>
      <Suspense
        fallback={
          <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-muted-foreground">
            Loading…
          </div>
        }
      >
        <Outlet />
      </Suspense>
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

type RunsView = "sessions" | "runs";

interface RunsSearch {
  status: StatusFilter;
  view: RunsView;
}

const runsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  validateSearch: (search: Record<string, unknown>): RunsSearch => ({
    status: search.status === "passed" || search.status === "failed" ? search.status : "all",
    view: search.view === "runs" ? "runs" : "sessions",
  }),
  loaderDeps: ({ search: { status, view } }) => ({ status, view }),
  loader: ({ context, deps }) =>
    deps.view === "sessions"
      ? context.queryClient.ensureQueryData(sessionsListQueryOptions())
      : context.queryClient.ensureQueryData(runsListQueryOptions({ status: deps.status })),
  component: RunsListPage,
});

const runDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(runDetailQueryOptions(params.runId)),
  component: RunDetailPage,
});

interface SuitesSearch {
  source: SuiteSourceFilter;
}

const suitesListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/suites",
  validateSearch: (search: Record<string, unknown>): SuitesSearch => {
    const s = search.source;
    if (s === "openapi-generated" || s === "manual" || s === "probe-suite") {
      return { source: s };
    }
    return { source: "all" };
  },
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(suitesListQueryOptions()),
  component: SuitesListPage,
});

const routeTree = rootRoute.addChildren([indexRoute, runsListRoute, runDetailRoute, suitesListRoute]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
