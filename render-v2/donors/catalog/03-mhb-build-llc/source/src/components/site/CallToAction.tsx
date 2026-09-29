import { client } from "@/lib/bridge";
import { Link } from "react-router-dom";
import { Phone, ArrowUpRight } from "lucide-react";
import { business } from "@/lib/business";
import { Button } from "@/components/ui/button";

export const CallToAction = ({ title, sub }: { title?: string; sub?: string }) => (
  <section className="py-20 md:py-28">
    <div className="container-wide">
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-ink text-primary-foreground p-10 md:p-20 shadow-elegant grain">
        <div className="absolute inset-0 bg-gradient-glow opacity-80" aria-hidden />
        <div className="absolute inset-0 blueprint opacity-30" aria-hidden />
        <div className="absolute top-8 right-8 mono text-[10px] uppercase tracking-[0.24em] text-primary-foreground/50">
          / Project-ready
        </div>

        <div className="relative grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-8">
            <h2 className="font-display font-light text-4xl md:text-7xl leading-[0.98] tracking-tight">
              {title || client.content.ctaHeadline || `Contact ${business.name}`}
            </h2>
            <p className="mt-6 text-primary-foreground/75 text-lg max-w-xl leading-relaxed">
              {sub || client.content.ctaBody}
            </p>
          </div>
          <div className="lg:col-span-4 flex flex-col gap-3">
            <div className="btn-glow rounded-full">
              <Button asChild size="lg" className="w-full bg-accent text-accent-foreground hover:bg-accent/95 shadow-brass h-14 text-base rounded-full shine-sweep relative overflow-hidden">
                <Link to="/contact">Request Estimate <ArrowUpRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
            <a href={business.phoneHref}
              className="inline-flex items-center justify-center gap-2 h-14 rounded-full glass hover:border-accent hover:text-accent transition-colors font-medium mono text-sm">
              <Phone className="h-4 w-4" /> {business.phone}
            </a>
            {business.email && <a href={business.emailHref} className="text-center mono text-[10px] uppercase tracking-[0.24em] text-primary-foreground/60 mt-1 hover:text-accent break-all">
              {business.email}
            </a>}
          </div>
        </div>
      </div>
    </div>
  </section>
);
