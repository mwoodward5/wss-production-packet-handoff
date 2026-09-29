import {jsonLdScript,ldLocalBusiness} from "@/lib/seo";
import {Outlet,Link,createRootRoute,HeadContent} from '@tanstack/react-router';
import {SiteHeader,SiteFooter,StickyMobileCTA} from '@/components/site-chrome';
import {client} from '@/lib/bridge';
function NotFoundComponent() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <div className="eyebrow">Error 404</div>
        <h1 className="mt-4 font-display text-6xl text-ink">Page not found</h1>
        <p className="mt-4 text-muted-foreground">
          The page you're looking for has been moved or doesn't exist.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <Link to="/" className="px-5 py-3 rounded-sm bg-ink text-bone text-[14px] font-medium">Return home</Link>
          <Link to="/contact" className="px-5 py-3 rounded-sm border border-border text-[14px] font-medium">Contact us</Link>
        </div>
      </div>
    </div>
  );
}


export const Route=createRootRoute({head:()=>({links:[{rel:"icon",href:client.identity.logoOnLight}],scripts:[jsonLdScript(ldLocalBusiness())]}),component:RootComponent,notFoundComponent:NotFoundComponent});
function RootComponent() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <HeadContent /><SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
      <StickyMobileCTA />
    </div>
  );
}
