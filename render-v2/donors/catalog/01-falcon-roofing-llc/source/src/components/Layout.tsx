import { Outlet, ScrollRestoration } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { StickyMobileCta } from "./StickyMobileCta";

export const Layout = () => (
  <div className="flex min-h-screen flex-col bg-background">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">Skip to content</a>
    <Header />
    <main id="main" className="flex-1 pb-20 lg:pb-0">
      <Outlet />
    </main>
    <Footer />
    <StickyMobileCta />
    <ScrollRestoration />
  </div>
);
