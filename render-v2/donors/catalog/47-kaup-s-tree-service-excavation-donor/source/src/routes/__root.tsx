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

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist. Head back home or call us at (731) 610-2627.
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
          Something went wrong. Try again, or call Kaup's directly at (731) 610-2627.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
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

const localBusinessJsonLd = {
  "@context": "https://schema.org",
  "@type": "TreeService",
  name: "Kaup's Tree Service LLC & Excavation",
  alternateName: "Kaup's Tree Service & Excavation",
  description:
    "Family-run tree service, excavation and storm shelter installation serving Selmer, McNairy County and surrounding TN/MS communities. Licensed & insured, free estimates.",
  url: "/",
  telephone: "+17316102627",
  email: "kaupstreeservice@gmail.com",
  image: "/__l5e/assets-v1/logo",
  address: {
    "@type": "PostalAddress",
    streetAddress: "578 Crabtree Rd",
    addressLocality: "Selmer",
    addressRegion: "TN",
    postalCode: "38375",
    addressCountry: "US",
  },
  areaServed: [
    { "@type": "AdministrativeArea", name: "McNairy County, Tennessee" },
    { "@type": "City", name: "Selmer, TN" },
    { "@type": "City", name: "Adamsville, TN" },
    { "@type": "City", name: "Bethel Springs, TN" },
    { "@type": "City", name: "Savannah, TN" },
    { "@type": "City", name: "Pickwick Lake" },
    { "@type": "City", name: "Iuka, MS" },
  ],
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: "07:00",
      closes: "19:00",
    },
  ],
  priceRange: "$$",
  sameAs: [
    "https://www.facebook.com/p/Kaups-Tree-Service-LLC-Excavation-61575959351722/",
    "https://www.bbb.org/us/tn/selmer/profile/tree-service/kaups-tree-service-llc-excavation-0543-44187900",
    "https://maps.app.goo.gl/BW9WHzjiym6ZzpBd7",
  ],
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0F2A1D" },
      { property: "og:site_name", content: "Kaup's Tree Service & Excavation" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Kaup's Tree Service & Excavation" },
      { property: "og:title", content: "Kaup's Tree Service & Excavation" },
      { name: "twitter:title", content: "Kaup's Tree Service & Excavation" },
      { name: "description", content: "Tree service, excavation, land clearing, storm cleanup, and storm shelter installation for Selmer, TN and McNairy County." },
      { property: "og:description", content: "Tree service, excavation, land clearing, storm cleanup, and storm shelter installation for Selmer, TN and McNairy County." },
      { name: "twitter:description", content: "Tree service, excavation, land clearing, storm cleanup, and storm shelter installation for Selmer, TN and McNairy County." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/03aeabdb-cc6e-4586-b471-f0236830a2ec/id-preview-8b875fea--1da03c93-74bd-49ff-9fc9-7e771abb7c26.lovable.app-1781760455969.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/03aeabdb-cc6e-4586-b471-f0236830a2ec/id-preview-8b875fea--1da03c93-74bd-49ff-9fc9-7e771abb7c26.lovable.app-1781760455969.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(localBusinessJsonLd),
      },
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
      <Outlet />
    </QueryClientProvider>
  );
}
