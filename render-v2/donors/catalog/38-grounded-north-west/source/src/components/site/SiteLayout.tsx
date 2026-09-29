import { Outlet } from "react-router-dom";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { StickyMobileCTA } from "./StickyMobileCTA";
import { ScrollToTop } from "./ScrollToTop";

export const SiteLayout = () => (
  <div className="min-h-screen bg-background text-foreground">
    <ScrollToTop />
    <SiteHeader />
    <main className="pb-24 lg:pb-0"><Outlet /></main>
    <SiteFooter />
    <StickyMobileCTA />
  </div>
);
