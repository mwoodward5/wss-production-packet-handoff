import { Outlet, Link, createRootRoute } from "@tanstack/react-router";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { StickyCallBar } from "../components/StickyCallBar";

// CLIENT-SPA root (WSS donor port, concrete lane).
//
// WHAT CHANGED FROM THE TANSTACK-START ROOT AND WHY
// The Start root owned the whole document: `shellComponent` rendered
// <html>/<head>/<body>, `head()` declared every meta/link/script, and the
// prerenderer wrote that document out per route together with a $_TSR
// hydration payload. That is the shape the fleet has been fighting:
//   * a serialized SSR payload the client must re-match exactly, and
//   * a multi-chunk ESM tree whose cross-chunk imports Vercel's function
//     builder will happily CommonJS-transpile into "exports is not defined".
//
// The WSS shell (index.html) owns <head> instead — the exact same tokens,
// NEED blocks, ld+json, Google Fonts links and hero-video ladder island the
// Start head() emitted, lifted verbatim out of the shipped donor shell. This
// root renders ONLY the design's frame, exactly as it looked.
//
// The design is untouched: SiteHeader, the <Outlet/> main, SiteFooter,
// StickyCallBar and the mobile bottom-bar spacer, in that order.

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-semibold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
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

function RootComponent() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <StickyCallBar />
      {/* Mobile bottom-bar spacer */}
      <div className="h-16 lg:hidden" />
    </div>
  );
}
