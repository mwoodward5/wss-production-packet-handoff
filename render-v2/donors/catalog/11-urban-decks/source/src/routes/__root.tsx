import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { localBusinessJsonLd, organizationJsonLd } from "@/lib/schema";
import { SITE } from "@/lib/site";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow text-cedar">404</p>
        <h1 className="mt-3 font-display text-5xl text-foreground">Page not found</h1>
        <p className="mt-3 text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-cedar px-6 py-3 text-sm font-semibold text-cream"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
 component: RootComponent, notFoundComponent: NotFoundComponent,
 head:()=>({meta:[{title:SITE.name}],scripts:[{type:'application/ld+json',children:JSON.stringify(localBusinessJsonLd)},{type:'application/ld+json',children:JSON.stringify(organizationJsonLd)}]})
});

function RootComponent() {
  return (
    <>
      <HeadContent /><SiteHeader />
      <main className="min-h-screen">
        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}
