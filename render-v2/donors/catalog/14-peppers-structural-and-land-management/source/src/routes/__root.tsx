import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { StickyCallBar } from "@/components/site/StickyCallBar";
import { LocalBusinessSchema, WebSiteSchema } from "@/components/site/Schema";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-6">
      <div className="max-w-md text-center">
        <p className="eyebrow">[ 404 · Off the map ]</p>
        <h1 className="mt-4 font-display text-6xl text-ink">Not found</h1>
        <p className="mt-4 text-charcoal/70">
          The page you're looking for has been moved, or never existed.
        </p>
        <Link to="/" className="btn-primary mt-8">Back to home →</Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Peppers Structural — Remodeling in Genoa, OH" },
      {
        name: "description",
        content:
          "Owner-operated home remodeling, decks, additions, kitchens, and custom carpentry in Genoa, Ohio. Free estimates. Workmanship warranty. Call (517) 438-2423.",
      },
      { name: "author", content: "Peppers Structural and Land Management LLC" },
      { name: "theme-color", content: "#f5f1ea" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Peppers Structural & Land Management" },
      { property: "og:title", content: "Peppers Structural — Remodeling in Genoa, OH" },
      { property: "og:description", content: "Owner-operated home remodeling, decks, additions, kitchens, and custom carpentry in Genoa, OH and Northwest Ohio. Free written estimates." },
      { property: "og:url", content: "https://pepper.wss-ai.com/" },
      { property: "og:locale", content: "en_US" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
      { name: "twitter:title", content: "Peppers Structural — Remodeling in Genoa, OH" },
      { name: "twitter:description", content: "Owner-operated home remodeling, decks, additions, kitchens, and custom carpentry in Genoa, OH and Northwest Ohio." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/902d1a4e-a898-4ec3-99e2-bfc568c26743/id-preview-8656f0cd--cfd022fd-a3ee-4ed5-a77d-d7743b1945e2.lovable.app-1777595165603.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/902d1a4e-a898-4ec3-99e2-bfc568c26743/id-preview-8656f0cd--cfd022fd-a3ee-4ed5-a77d-d7743b1945e2.lovable.app-1777595165603.png" },
      { name: "geo.region", content: "US-OH" },
      { name: "geo.placename", content: "Genoa, Ohio" },
      { name: "geo.position", content: "41.5169;-83.3597" },
      { name: "ICBM", content: "41.5169, -83.3597" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/favicon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/favicon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/favicon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300;1,9..144,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <LocalBusinessSchema />
        <WebSiteSchema />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <div className="flex min-h-screen flex-col bg-cream pb-14 lg:pb-0">
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <StickyCallBar />
    </div>
  );
}
