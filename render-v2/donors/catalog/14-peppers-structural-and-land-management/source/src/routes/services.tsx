import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout route for /services. The actual listing page lives in
 * routes/services.index.tsx; detail pages live in routes/services.$slug.tsx.
 * This file MUST render <Outlet /> so child routes appear (TanStack Router
 * requirement for parent routes that have children).
 */
export const Route = createFileRoute("/services")({
  component: () => <Outlet />,
});
