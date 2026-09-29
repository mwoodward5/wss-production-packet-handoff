import { Outlet, createRootRoute, HeadContent } from '@tanstack/react-router';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { StickyMobileCta } from '@/components/site/StickyMobileCta';
import { NotFound } from '@/components/site/NotFound';
export const Route = createRootRoute({ component: RootComponent, notFoundComponent: NotFound });
function RootComponent() {
  return <>
    <HeadContent />
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1"><Outlet /></main>
      <SiteFooter />
      <StickyMobileCta />
    </div>
  </>;
}
