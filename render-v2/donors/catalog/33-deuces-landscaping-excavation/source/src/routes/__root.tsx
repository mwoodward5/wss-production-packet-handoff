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
      { title: "DEUCES Landscaping & Excavation" },
      { property: "og:title", content: "DEUCES Landscaping & Excavation" },
      { name: "twitter:title", content: "DEUCES Landscaping & Excavation" },
      { name: "description", content: "Cadillac, MI excavation, landscaping, storm cleanup and remodeling for Northern Michigan. A+ BBB accredited and 5-star reviewed on Google." },
      { property: "og:description", content: "Cadillac, MI excavation, landscaping, storm cleanup and remodeling for Northern Michigan. A+ BBB accredited and 5-star reviewed on Google." },
      { name: "twitter:description", content: "Cadillac, MI excavation, landscaping, storm cleanup and remodeling for Northern Michigan. A+ BBB accredited and 5-star reviewed on Google." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5ffce5ac-bfc8-4c90-834e-032ba153b8b8" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5ffce5ac-bfc8-4c90-834e-032ba153b8b8" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: BRAND.favicon },
      { rel: "apple-touch-icon", href: BRAND.appleTouchIcon },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    scripts: SEO.gtmId
      ? [{
          children: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${SEO.gtmId}');`,
        }]
      : [],
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
        {SEO.gtmId ? (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${SEO.gtmId}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        ) : null}
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
