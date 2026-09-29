import { Link } from "@tanstack/react-router";
import { Phone, MessageSquare, ArrowRight, MapPin, Shield, Clock, Truck, Star } from "lucide-react";
import { TEL_HREF, SMS_HREF, BUSINESS } from "@/lib/business";
import HERO_IMG from "@/assets/fts-hero-cinematic.webp";

/**
 * Premiere FT hero — single dominant cinematic frame.
 * VO3-ready: the photo plate is one isolated layer behind the
 * overlay grade, ready to be swapped for a looping <video>.
 */
export function PremiereHero() {
  return (
    <section
      className="relative isolate overflow-hidden bg-fts-hero text-surface-foreground fts-grain"
      aria-label="Favorite Tree Service hero"
    >
      {/* PHOTO PLATE — replace with <video> when VO3 drop arrives */}
      <div className="absolute inset-0 -z-10">
        <img
          src={HERO_IMG}
          alt=""
          aria-hidden
          className="h-full w-full object-cover object-right animate-slow-parallax"
        />
        {/* cinematic forest-midnight grade, brand-pack 70-85% dark overlay */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(95deg, oklch(0.08 0.015 155 / 0.92) 0%, oklch(0.10 0.018 155 / 0.78) 38%, oklch(0.10 0.018 155 / 0.45) 62%, oklch(0.08 0.015 155 / 0.55) 100%)",
          }}
        />
        {/* radiating amber sun-glint */}
        <div
          className="pointer-events-none absolute right-[18%] top-[12%] h-[420px] w-[420px] rounded-full blur-3xl animate-amber-radiate"
          style={{ background: "radial-gradient(circle, oklch(0.71 0.135 70 / 0.45), transparent 65%)" }}
          aria-hidden
        />
        {/* deep evergreen lift bottom */}
        <div
          className="pointer-events-none absolute -bottom-32 left-[10%] h-[520px] w-[520px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.45 0.09 153 / 0.35), transparent 70%)" }}
          aria-hidden
        />
      </div>

      {/* Top brand hairline */}
      <div className="relative overflow-hidden">
        <div className="fts-amber-line" />
        <div className="absolute inset-0">
          <div className="absolute inset-y-0 -left-1/3 w-1/3 animate-hairline-sweep bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pb-28 pt-20 sm:px-6 sm:pb-36 sm:pt-28 lg:grid-cols-12 lg:items-end lg:gap-14 lg:px-8 lg:pb-44 lg:pt-40">
        {/* LEFT — typographic authority */}
        <div className="lg:col-span-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85 backdrop-blur animate-fade-up">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-accent" style={{ background: "oklch(0.74 0.135 70)" }} />
            <MapPin className="h-3.5 w-3.5" /> Barboursville · Charlottesville · Central Virginia
          </div>

          <h1
            className="mt-7 font-extrabold leading-[0.92] tracking-[-0.035em] animate-fade-up"
            style={{ fontSize: "clamp(2.6rem, 7.2vw, 6.5rem)" }}
          >
            <span className="block text-white/95">Premium</span>
            <span className="block text-white/95">Arborist Work,</span>
            <span className="block">
              Done in{" "}
              <span className="relative inline-block">
                <span className="text-amber-accent">Central&nbsp;Virginia</span>
                <span
                  className="absolute -bottom-2 left-0 h-[3px] w-full rounded-full"
                  style={{ background: "linear-gradient(90deg, transparent, oklch(0.71 0.135 70 / 0.95), transparent)" }}
                  aria-hidden
                />
              </span>
              .
            </span>
          </h1>

          <p
            className="mt-8 max-w-2xl text-lg leading-relaxed text-white/75 sm:text-xl animate-fade-up"
            style={{ animationDelay: "120ms" }}
          >
            Bucket-truck reach, climbing precision, and storm-ready response.
            Tall canopy removal, structural pruning, stump grinding, and 24/7 emergency work — handled by a real local crew.
          </p>

          {/* CTAs — amber primary on dark, ivory outline secondary */}
          <div
            className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center animate-fade-up"
            style={{ animationDelay: "240ms" }}
          >
            <a
              href={TEL_HREF}
              className="group inline-flex items-center justify-center gap-2.5 rounded-md bg-cta-gradient px-7 py-4 text-base font-bold text-accent-foreground shadow-amber transition-smooth hover:scale-[1.02]"
            >
              <Phone className="h-5 w-5" /> Call {BUSINESS.phoneDisplay}
            </a>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/25 bg-white/5 px-7 py-4 text-base font-semibold text-white backdrop-blur transition-smooth hover:bg-white/10"
            >
              Get a Free Estimate <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={SMS_HREF}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-white/15 px-5 py-4 text-sm font-semibold text-white/85 transition-smooth hover:bg-white/10"
            >
              <MessageSquare className="h-4 w-4" /> Text
            </a>
          </div>

          {/* Trust strip — natural-metal icons, restrained amber dots */}
          <div
            className="mt-12 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 animate-fade-up"
            style={{ animationDelay: "360ms" }}
          >
            {[
              { icon: Clock, label: "24/7 Emergency" },
              { icon: Shield, label: "Licensed & Insured" },
              { icon: Truck, label: "Bucket Truck" },
              { icon: Star, label: "5★ Local Reviews" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 text-sm text-white/80">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/5 backdrop-blur">
                  <Icon className="h-4 w-4 text-white/90" />
                </span>
                <span className="font-semibold tracking-tight">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — vertical detail rail (premium frame, no collage) */}
        <div className="hidden lg:col-span-4 lg:block">
          <div className="relative ml-auto w-full max-w-sm animate-fade-up" style={{ animationDelay: "180ms" }}>
            {/* Spec card — VO3 frame anchor */}
            <div className="relative rounded-2xl border border-white/12 bg-black/40 p-6 backdrop-blur-md shadow-glow">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">
                <span>On Site</span>
                <span className="text-amber-accent">LIVE</span>
              </div>
              <div className="mt-5 text-[11px] uppercase tracking-[0.18em] text-white/55">Job</div>
              <div className="mt-1 text-xl font-bold text-white">
                Bucket-Truck Canopy Reach
              </div>
              <div className="mt-1 text-sm text-white/65">
                Hardwood overhang · residential clearance
              </div>

              <div className="my-6 fts-metal-rule" />

              <dl className="grid grid-cols-2 gap-y-4 text-xs">
                <div>
                  <dt className="text-white/50 uppercase tracking-[0.16em]">Reach</dt>
                  <dd className="mt-1 text-base font-bold text-white">55 ft+</dd>
                </div>
                <div>
                  <dt className="text-white/50 uppercase tracking-[0.16em]">Crew</dt>
                  <dd className="mt-1 text-base font-bold text-white">Insured</dd>
                </div>
                <div>
                  <dt className="text-white/50 uppercase tracking-[0.16em]">Response</dt>
                  <dd className="mt-1 text-base font-bold text-white">24 / 7</dd>
                </div>
                <div>
                  <dt className="text-white/50 uppercase tracking-[0.16em]">Estimate</dt>
                  <dd className="mt-1 text-base font-bold text-amber-accent">Free</dd>
                </div>
              </dl>

              <div className="my-6 fts-metal-rule" />

              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/55">Local Authority</div>
                <div className="flex items-center gap-1 text-amber-accent">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-current" />
                  ))}
                </div>
              </div>
            </div>

            {/* Floating amber radius indicator */}
            <div
              className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full border opacity-80"
              style={{ borderColor: "oklch(0.71 0.135 70 / 0.55)" }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -right-2 -top-2 h-8 w-8 rounded-full"
              style={{ background: "oklch(0.71 0.135 70 / 0.85)", boxShadow: "0 0 40px oklch(0.71 0.135 70 / 0.7)" }}
              aria-hidden
            />
          </div>
        </div>
      </div>

      {/* Bottom hairline divider into next section */}
      <div className="relative">
        <div className="fts-amber-line" />
      </div>
    </section>
  );
}
