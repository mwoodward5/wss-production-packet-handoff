import { ReactNode } from "react";
import { MapPin, Sparkles } from "lucide-react";

/**
 * Minimalist wellness/professional-services hero.
 *
 * The simplest hero in the kit — a single background photo with a gradient
 * veil, eyebrow chip, headline, lede, and CTA. No motion beyond a soft
 * initial rise. Best for calm/premium/professional verticals where too much
 * motion would feel wrong (medical, legal, spa, finance, wellness).
 *
 * Extracted from the ServicePage template — use this shape on both landing
 * pages and service sub-pages.
 */
export interface ServiceHeroProps {
  eyebrow: string;
  h1: string;
  lede: string;
  image: string;      // hero photo URL
  alt: string;        // photo alt text
  location?: string;  // "Serving <city, region>" line
  cta?: ReactNode;    // <CTAButtons /> or your own buttons
}

export function ServiceHero(p: ServiceHeroProps) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <img src={p.image} alt={p.alt} width={1920} height={1080} fetchPriority="high"
             className="h-full w-full object-cover opacity-90" />
        {/* Gradient veil — define in your global CSS as --gradient-hero.
            Example: linear-gradient(180deg, oklch(0.15 0.03 155 / 0.15) 0%, oklch(0.12 0.02 150 / 0.75) 100%) */}
        <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
      </div>
      <div className="container-wide pt-12 md:pt-20 pb-16 md:pb-28">
        <div className="mt-6 max-w-3xl animate-rise">
          <p className="eyebrow inline-flex items-center gap-2 bg-card/70 backdrop-blur rounded-full px-3 py-1">
            <Sparkles className="h-3.5 w-3.5" /> {p.eyebrow}
          </p>
          <h1 className="mt-5 text-balance">{p.h1}</h1>
          <p className="lede mt-5 text-pretty">{p.lede}</p>
          {p.cta}
          {p.location && (
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-accent" /> {p.location}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/*
Usage example:

<ServiceHero
  eyebrow="Craniosacral therapy"
  h1="Nervous-system calm, delivered gently."
  lede="An hour of quiet touch that helps your body find its own equilibrium — sleep better tonight, breathe easier tomorrow."
  image="/img/therapy-room.jpg"
  alt="Sunlit treatment room with soft neutrals"
  location="Serving South Houston, TX & the greater Houston metro"
  cta={<div className="mt-6 flex gap-3"><button>Book a session</button><a>Learn more</a></div>}
/>
*/
