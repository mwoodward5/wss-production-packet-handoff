import { Outlet, Link, createRootRoute, useRouterState } from "@tanstack/react-router";
import { SiteHeader, StickyMobileCTA } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { LocalBusinessSchema } from "@/components/site/Schema";
import { CredentialsSchema } from "@/components/site/CredentialsSchema";

import { useEffect } from "react";
import { CLIENT, SERVICES } from "@/lib/wss";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

export function RootComponent() {
  const path=useRouterState({select:s=>s.location.pathname});
  useEffect(()=>{const service=SERVICES.find(s=>path===s.href || path===`/services/${s.slug}`);document.title=(service?.name || (path==='/'?'':path.split('/').filter(Boolean).at(-1)?.replaceAll('-',' ')) || '')+' | '+CLIENT.identity.businessName;},[path]);
  return (
    <div className="flex min-h-screen flex-col">
      <LocalBusinessSchema />
      <CredentialsSchema />
      <SiteHeader />
      <main className="flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>
      <SiteFooter />
      <StickyMobileCTA />
    </div>
  );
}
