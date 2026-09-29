/**
 * Animated hero — config-driven, 3 variants.
 * Switches on BRAND.heroVariant. All variants tolerate empty/placeholder media.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Phone, ArrowRight, MapPin } from "lucide-react";
import { CLIENT, BRAND, HERO } from "@/config";

interface HeroProps {
  eyebrow?: string;
  headline?: string;
  subhead?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  imageSrc?: string;
}

function resolveCopy(props: HeroProps) {
  return {
    eyebrow:
      props.eyebrow ??
      HERO.eyebrow ??
      `${CLIENT.city}, ${CLIENT.region} · ${CLIENT.serviceAreaLabel}`,
    headline: props.headline ?? HERO.headline ?? CLIENT.businessName,
    subhead: props.subhead ?? HERO.subheadline ?? CLIENT.shortDescription,
    primary:
      props.primaryCta ??
      HERO.primaryCta ?? { label: `Call ${CLIENT.phone}`, href: `tel:${CLIENT.phoneE164}` },
    secondary:
      props.secondaryCta ??
      HERO.secondaryCta ?? { label: "Request an estimate", href: "/contact" },
  };
}

function Eyebrow({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.86_0.10_85/0.4)] bg-[oklch(0.18_0.02_140/0.55)] backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)] lg:px-2 lg:py-1 lg:text-[0.6rem] lg:tracking-tight">
      <MapPin className="w-3 h-3 text-[var(--gold)]" /> {text}
    </span>
  );
}

function Ctas({
  primary,
  secondary,
}: {
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <a
        href={primary.href}
        className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        <Phone className="w-4 h-4" /> {primary.label}
      </a>
      <Link
        to={secondary.href as "/contact"}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 backdrop-blur px-5 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
      >
        {secondary.label} <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

/* ---------- variant: cinematic-video ---------- */
function CinematicHero(props: HeroProps) {
  const { eyebrow, headline, subhead, primary, secondary } = resolveCopy(props);
  const video = HERO.video;
  const poster = HERO.poster ?? HERO.images[0] ?? props.imageSrc;
  return (
    <section className="relative overflow-hidden">
      <div className="relative h-[88vh] min-h-[520px] md:h-[82vh] md:min-h-[600px] w-full">
        {video ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            poster={poster}
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src={video} />
          </video>
        ) : poster ? (
          <img
            src={poster}
            alt={CLIENT.businessName}
            width={1920}
            height={1080}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-secondary/40 via-background to-primary/30" />
        )}
        {/* Warm readable veil — light first impression, dark only where text sits */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, oklch(0.18 0.02 140 / 0.78) 0%, oklch(0.22 0.02 140 / 0.45) 35%, oklch(0.30 0.03 135 / 0.15) 65%, transparent 100%)",
          }}
        />
        <div
          className="absolute inset-0 mix-blend-multiply opacity-30"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.30 0.05 135 / 0.30) 0%, transparent 50%, oklch(0.32 0.10 22 / 0.22) 100%)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-7xl px-5 lg:px-8 h-full flex flex-col justify-end pb-12 md:pb-16">
          <Eyebrow text={eyebrow} />
          <h1 className="mt-5 text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight max-w-4xl animate-fade-in text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.55)]">
            {headline}
          </h1>
          <p className="mt-5 text-lg md:text-xl text-white/90 max-w-2xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">{subhead}</p>
          <Ctas primary={primary} secondary={secondary} />
        </div>
      </div>
    </section>
  );
}

/* ---------- variant: split-collage ---------- */
function SplitCollageHero(props: HeroProps) {
  const { eyebrow, headline, subhead, primary, secondary } = resolveCopy(props);
  const images = HERO.images.length ? HERO.images : props.imageSrc ? [props.imageSrc] : [];
  return (
    <section className="relative">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-16 pb-12 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
        <div>
          <Eyebrow text={eyebrow} />
          <h1 className="mt-5 text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight">
            {headline}
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-xl">{subhead}</p>
          <Ctas primary={primary} secondary={secondary} />
        </div>
        {images.length > 0 ? (
          <div className="grid grid-cols-2 grid-rows-2 gap-3 aspect-square">
            <div className="row-span-2 relative rounded-3xl overflow-hidden border border-border bg-muted">
              {images[0] && <img src={images[0]} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="relative rounded-3xl overflow-hidden border border-border bg-muted">
              {images[1] && <img src={images[1]} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="relative rounded-3xl overflow-hidden border border-border bg-muted">
              {images[2] && <img src={images[2]} alt="" className="w-full h-full object-cover" />}
            </div>
          </div>
        ) : (
          <div className="relative aspect-square rounded-3xl border border-dashed border-border bg-muted/30" />
        )}
      </div>
    </section>
  );
}

/* ---------- variant: parallax-stack ---------- */
function ParallaxStackHero(props: HeroProps) {
  const { eyebrow, headline, subhead, primary, secondary } = resolveCopy(props);
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  useEffect(() => {
    const onScroll = () => setY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const images = HERO.images.length ? HERO.images : props.imageSrc ? [props.imageSrc] : [];
  return (
    <section ref={ref} className="relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
        <div className="relative z-10">
          <Eyebrow text={eyebrow} />
          <h1 className="mt-5 text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight">
            {headline}
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-xl">{subhead}</p>
          <Ctas primary={primary} secondary={secondary} />
        </div>
        <div className="relative h-[520px]">
          {images.slice(0, 3).map((src, i) => (
            <div
              key={i}
              className="absolute rounded-3xl overflow-hidden border border-border bg-muted shadow-xl"
              style={{
                top: `${i * 40}px`,
                left: `${i * 30}px`,
                width: "70%",
                height: "70%",
                transform: `translateY(${y * (0.05 + i * 0.08)}px)`,
                zIndex: i,
              }}
            >
              <img src={src} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
          {images.length === 0 && (
            <div className="absolute inset-0 rounded-3xl border border-dashed border-border bg-muted/30" />
          )}
        </div>
      </div>
    </section>
  );
}

export function AnimatedHero(props: HeroProps = {}) {
  switch (BRAND.heroVariant) {
    case "cinematic-video":
      return <CinematicHero {...props} />;
    case "parallax-stack":
      return <ParallaxStackHero {...props} />;
    case "split-collage":
    default:
      return <SplitCollageHero {...props} />;
  }
}
