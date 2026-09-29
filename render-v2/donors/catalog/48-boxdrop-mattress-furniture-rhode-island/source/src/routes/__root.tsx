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
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { StickyMobileCTA } from "@/components/site/StickyMobileCTA";
import { ExitIntentToast } from "@/components/site/ExitIntentToast";
import { business } from "@/data/business";
import heroAsset from "@/assets/hero/hero-showroom.jpg.asset.json";



function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          404
        </p>
        <h1 className="mt-3 text-3xl font-extrabold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That page doesn't exist. Head back to the BoxDrop Rhode Island homepage to
          keep browsing.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground"
          >
            Go home
          </Link>
          <a
            href={`tel:${business.telephone}`}
            data-event="click_call"
            className="rounded-full border border-foreground/20 px-5 py-2.5 text-sm font-semibold"
          >
            Call {business.displayPhone}
          </a>
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
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try again, or call us if you need help.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground"
          >
            Try again
          </button>
          <a
            href={`tel:${business.telephone}`}
            data-event="click_call"
            className="rounded-full border border-foreground/20 px-5 py-2.5 text-sm font-semibold"
          >
            Call {business.displayPhone}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    const ga4Id =
      (import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined) ||
      "G-1VFVKG6477";
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "author", content: business.name },
        { property: "og:site_name", content: business.shortName },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "theme-color", content: "#1a233a" },
        {
          name: "google-site-verification",
          content: "K4Sw6OIalTW1QmzZ_pXqOYulS4AxftfdG8k70lIUC0c",
        },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,900&family=Inter:wght@400;500;600;700;800&display=swap",
        },
        { rel: "preload", as: "image", href: heroAsset.url, fetchpriority: "high" },
      ],
      scripts: ga4Id
        ? [
            {
              src: `https://www.googletagmanager.com/gtag/js?id=${ga4Id}`,
              async: true,
            },
            {
              children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4Id}',{send_page_view:true});`,
            },
          ]
        : [],
    };
  },
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
  const router = useRouter();

  useEffect(() => {
    void import("@/lib/analytics").then((m) => m.installClickTracking());
  }, []);

  // Fire a GA4 page_view on every client-side route change.
  useEffect(() => {
    return router.subscribe("onResolved", ({ toLocation }) => {
      if (typeof window === "undefined" || typeof window.gtag !== "function") return;
      const ga4Id =
        (import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined) ||
        "G-1VFVKG6477";
      if (!ga4Id) return;
      window.gtag("event", "page_view", {
        page_path: toLocation.pathname,
        page_location: window.location.href,
        page_title: document.title,
      });
    });
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">
          {/* Required: nested routes render here. */}
          <Outlet />
        </main>
        <SiteFooter />
      </div>
      <StickyMobileCTA />
      <ExitIntentToast />
    </QueryClientProvider>
  );
}
