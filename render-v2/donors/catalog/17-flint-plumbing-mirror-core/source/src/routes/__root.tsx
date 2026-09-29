/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: shell — header, footer, Google Fonts <link>,
 * │ favicon, palette injection, sitemap/llms.txt registration.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT:
 * │   clientConfig.brand.wordmark / wordmarkSub <- Places displayName + tagline
 * │   clientConfig.brand.logoSrc  <- Firecrawl branding.logo, re-hosted at /public/brand/logo.png
 * │   clientConfig.brand.fonts    <- Firecrawl branding.typography.fontFamilies (map to Google Fonts)
 * │   clientConfig.brand.palette  <- Firecrawl branding.colors, hex converted to oklch
 * │   clientConfig.canonicalUrl   <- the subdomain you deploy this mirror on
 * │   trustConfig.contact.phone / bookingUrl <- Places nationalPhoneNumber / site booking link
 * │ FULL SPEC: MIRRORING-ENGINE.md §Brand and palette
 * └──────────────────────────────────────────────────────────────────────────
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import trustCss from "../trust-widgets/trust-widgets.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { clientConfig, fontHref } from "../client.config";

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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "author", content: clientConfig.brand.wordmark },
      { property: "og:site_name", content: clientConfig.brand.wordmark },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#0d3236" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { title: "Lovable App" },
      { property: "og:title", content: "Lovable App" },
      { name: "twitter:title", content: "Lovable App" },
      { name: "description", content: "A plumbing company website showcasing services, customer testimonials, and contact information." },
      { property: "og:description", content: "A plumbing company website showcasing services, customer testimonials, and contact information." },
      { name: "twitter:description", content: "A plumbing company website showcasing services, customer testimonials, and contact information." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/83c42c9e-b28b-4077-b232-8c20b3ce2151/id-preview-74460232--b0837193-3a75-48d0-a390-b98475e5461a.lovable.app-1785818581556.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/83c42c9e-b28b-4077-b232-8c20b3ce2151/id-preview-74460232--b0837193-3a75-48d0-a390-b98475e5461a.lovable.app-1785818581556.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "stylesheet", href: trustCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: fontHref(),
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "sitemap", type: "application/xml", href: "/sitemap.xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
