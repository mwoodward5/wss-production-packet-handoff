import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { TestimonialsCarousel } from "./TestimonialsCarousel";
import { GlobalCta } from "./GlobalCta";
import { ServiceAreaSection } from "./ServiceAreaSection";

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1">{children}</main>
      <TestimonialsCarousel />
      <GlobalCta />
      <ServiceAreaSection />
      <Footer />
    </div>
  );
}
