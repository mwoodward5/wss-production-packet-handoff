import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Analytics } from "@/components/site/Analytics";
import { SEO, CLIENT, BRAND } from "@/config";

import appCss from "../styles.css?url";

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
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: `${SEO.siteName}${SEO.titleSuffix.replace(SEO.siteName, "").trim() ? "" : ""}` },
      { name: "description", content: SEO.defaultDescription },
      { property: "og:site_name", content: SEO.siteName },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: SEO.locale },
      { name: "twitter:card", content: "summary_large_image" },
      ...(SEO.twitterHandle ? [{ name: "twitter:site", content: `@${SEO.twitterHandle}` }] : []),
      { name: "geo.region", content: `${CLIENT.country}-${CLIENT.region}` },
      { name: "geo.placename", content: `${CLIENT.city}, ${CLIENT.region}` },
      { name: "geo.position", content: `${CLIENT.latitude};${CLIENT.longitude}` },
      { name: "ICBM", content: `${CLIENT.latitude}, ${CLIENT.longitude}` },
      { name: "format-detection", content: "telephone=yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: SEO.siteName },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "robots", content: SEO.robotsPolicy === "index" ? "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" : "noindex, nofollow" },
      ...(SEO.gscVerification ? [{ name: "google-site-verification", content: SEO.gscVerification }] : []),
      ...(SEO.bingVerification ? [{ name: "msvalidate.01", content: SEO.bingVerification }] : []),
      { title: "All-Around Tree Care" },
      { property: "og:title", content: "All-Around Tree Care" },
      { name: "twitter:title", content: "All-Around Tree Care" },
      { name: "description", content: "Tree removal, tree care, lawn care, landscaping, cleanup, and firewood service for Clarksville and Montgomery County. Call Curt Lewis for a free estimate." },
      { property: "og:description", content: "Tree removal, tree care, lawn care, landscaping, cleanup, and firewood service for Clarksville and Montgomery County. Call Curt Lewis for a free estimate." },
      { name: "twitter:description", content: "Tree removal, tree care, lawn care, landscaping, cleanup, and firewood service for Clarksville and Montgomery County. Call Curt Lewis for a free estimate." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/516f102b-d8ca-47dc-bd18-1a0b2080930c/id-preview-f02d26a4--b76a5484-71f9-4759-8ad7-670034444bc8.lovable.app-1780127690470.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/516f102b-d8ca-47dc-bd18-1a0b2080930c/id-preview-f02d26a4--b76a5484-71f9-4759-8ad7-670034444bc8.lovable.app-1780127690470.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: BRAND.favicon },
      { rel: "apple-touch-icon", href: BRAND.appleTouchIcon },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang={SEO.locale.split("_")[0]} suppressHydrationWarning>
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
  return (
    <>
      <Analytics />
      <Outlet />
    </>
  );
}
