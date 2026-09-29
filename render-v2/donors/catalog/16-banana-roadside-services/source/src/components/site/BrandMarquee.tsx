import { ASSETS } from "@/assets/manifest";

const BRANDS: {name:string;src:string}[] = []; // No certified marque media contract.

/**
 * Auto-scrolling brand logo marquee.
 * `variant="hero"` renders only the moving logo strip (no section chrome),
 * for use inside the cinematic hero. Transparency, 3D treatment, 10s motion
 * and reduced-motion fallback are shared with the standalone section.
 */
function MarqueeTrack() {
  return (
    <div className="brand-marquee overflow-hidden">
      <div className="brand-marquee-track">
        {[...BRANDS, ...BRANDS, ...BRANDS].map((b, i) => (
          <div
            key={`${b.name}-${i}`}
            className="brand-logo-3d"
            aria-hidden={i >= BRANDS.length ? true : undefined}
          >
            <img
              src={b.src}
              alt={i < BRANDS.length ? `${b.name} logo` : ""}
              loading="lazy"
              className="brand-logo-img"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BrandMarquee({ variant = "section" }: { variant?: "section" | "hero" }) {
  if (!BRANDS.length) return null;
  if (variant === "hero") {
    return (
      <div aria-label="European brands we specialize in" className="w-full">
        <MarqueeTrack />
      </div>
    );
  }

  return (
    <section
      aria-label="European brands we specialize in"
      className="bg-background pt-14 pb-2 sm:pt-20 sm:pb-8"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--banana-deep)]">
            Luxury & European Expertise
          </span>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            We specialize in:
          </h2>
        </div>

        <div className="mt-10">
          <MarqueeTrack />
        </div>
      </div>
    </section>
  );
}

