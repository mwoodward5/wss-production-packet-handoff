import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Phone, MapPin, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { business, services } from "@/lib/business";
import { client } from "@/lib/bridge";

export const PremiumHero = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -rect.top / (rect.height || 1)));
      setY(progress);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const px = (mult: number) => ({ transform: `translate3d(0, ${reducedMotion ? 0 : y * mult}px, 0)` });

  const routeOptions = services.slice(0, 6);

  return (
    <section
      ref={ref}
      className="relative isolate overflow-hidden bg-gradient-ink text-primary-foreground grain min-h-[92vh]"
    >
      {/* Client media with the original architectural overlays. */}
      <img src={client.hero.poster} alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full object-cover opacity-[0.35] mix-blend-luminosity" />
      {client.hero.video && !reducedMotion && !videoFailed && (
        <video key={client.hero.video} autoPlay loop muted playsInline poster={client.hero.poster} onError={() => setVideoFailed(true)} aria-hidden className="absolute inset-0 -z-20 h-full w-full object-cover opacity-[0.35] mix-blend-luminosity">
          <source src={client.hero.video} onError={() => setVideoFailed(true)} />
        </video>
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-ink opacity-50" aria-hidden />
      <div className="absolute inset-0 -z-10 blueprint opacity-30" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_45%_at_30%_30%,hsl(215_45%_18%/0.55)_0%,transparent_70%)]" aria-hidden />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[120%] aspect-square aurora opacity-50 pointer-events-none" aria-hidden />
      <div className="absolute inset-x-0 top-0 h-[700px] bg-gradient-radial-brass opacity-70 pointer-events-none" aria-hidden />

      <div className="halo h-[420px] w-[420px] -left-32 top-40" aria-hidden style={px(-60)} />
      <div className="halo h-[320px] w-[320px] right-[-80px] top-[55%]" aria-hidden style={{ ...px(-40), animationDelay: "1.5s" }} />

      <div className="absolute inset-y-0 left-[8%] w-px bg-primary-foreground/[0.06] hidden md:block" aria-hidden />
      <div className="absolute inset-y-0 right-[8%] w-px bg-primary-foreground/[0.06] hidden md:block" aria-hidden />

      <div className="container-wide relative pt-10 pb-0">
        {/* Top meta bar */}
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.24em] text-primary-foreground/65 mono">
          <span className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            N° 01 — {business.city}, {business.state}
          </span>
          <span className="hidden md:inline">{business.name}</span>
          <span>{business.region}</span>
        </div>

        <div className="mt-16 md:mt-24 grid lg:grid-cols-12 gap-10 lg:gap-6 items-end min-h-[62vh]">
          {/* Headline column */}
          <div className="lg:col-span-7 reveal-up" style={px(-30)}>
            <span className="eyebrow text-accent">{client.hero.eyebrow}</span>
            <h1 className="mt-7 font-display font-light text-[2.75rem] sm:text-6xl lg:text-[6rem] leading-[0.94] tracking-[-0.03em] [text-wrap:balance] drop-shadow-[0_2px_30px_hsl(215_45%_4%/0.6)]">
              {client.hero.line1}<br />
              <span className="display-italic text-shine">{client.hero.emphasis}</span><br />
              {client.hero.line3}
            </h1>
            <p className="mt-10 max-w-xl text-primary-foreground/85 text-lg leading-relaxed drop-shadow-[0_1px_12px_hsl(215_45%_4%/0.7)]">
              {client.hero.support}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-5">
              <div className="btn-glow rounded-full">
                <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/95 h-14 px-7 text-base rounded-full relative overflow-hidden shine-sweep">
                  <Link to="/contact">
                    Request an Estimate <ArrowUpRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <a href={business.phoneHref} className="group inline-flex items-center gap-3 text-base">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-primary-foreground/30 bg-primary/30 backdrop-blur-md group-hover:border-accent group-hover:text-accent group-hover:shadow-glow-brass transition-all">
                  <Phone className="h-4 w-4" />
                </span>
                <span className="font-medium mono text-sm tracking-wide">{business.phone}</span>
              </a>
            </div>
          </div>

          {/* Process-routing module — explicitly NOT live, just navigates to services */}
          <div className="lg:col-span-5 relative" style={px(20)}>
            <div className="rounded-2xl bg-card/95 backdrop-blur-xl text-foreground p-7 shadow-float ring-1 ring-foreground/5">
              <div className="flex items-center justify-between">
                <p className="mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
                  <Compass className="h-3 w-3 text-accent" /> Project Router
                </p>
                <span className="mono text-[10px] uppercase tracking-widest text-accent">Step 01</span>
              </div>
              <h2 className="mt-4 font-display text-2xl leading-tight">What are you planning?</h2>
              <p className="mt-2 text-sm text-muted-foreground">Pick a starting point — we'll show what's involved and how to request an estimate.</p>
              <ul className="mt-5 grid grid-cols-2 gap-2">
                {routeOptions.map(service => {
                  const label = service.name;
                  const target = `/services/${service.slug}`;
                  return (
                    <li key={label}>
                      <Link
                        to={target}
                        className="flex items-center justify-between gap-2 rounded-lg border border-foreground/10 px-3 py-2.5 text-xs hover:border-accent hover:text-accent transition-colors"
                      >
                        <span>{label}</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-5 pt-5 border-t border-foreground/10 flex items-center justify-between">
                <span className="mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-accent" /> {business.city}, {business.state}
                </span>
                <Link to="/services" className="text-xs link-underline text-foreground hover:text-accent">All services →</Link>
              </div>
            </div>
            <p className="mt-3 mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/55 text-center">
              Explore services and plan your next step
            </p>
          </div>
        </div>

        {/* Bottom capability bar */}
        <div className="mt-20 md:mt-28 border-t border-primary-foreground/10 grid grid-cols-2 md:grid-cols-4 gap-px bg-primary-foreground/5 relative z-10">
          {services.slice(0, 4).map(({ name: t, shortLabel: s }) => (
            <div key={t} className="bg-[hsl(var(--ink))]/85 backdrop-blur-md py-7 px-2 text-center group hover:bg-[hsl(var(--primary-glow))] transition-colors">
              <p className="font-display text-xl group-hover:text-accent transition-colors">{t}</p>
              <p className="mt-1 text-xs text-primary-foreground/60 mono uppercase tracking-widest">{s}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
