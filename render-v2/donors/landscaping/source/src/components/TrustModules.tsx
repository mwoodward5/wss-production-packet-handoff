import { useEffect, useState } from "react";
import { Star, MapPin, Phone, Clock, ArrowUpRight, Quote, BadgeCheck, CalendarCheck } from "lucide-react";

// Verified from the public Google Business Profile (Place ID ChIJHeEcJVVfPQYRbHzJ6YFMhHE), crawled Sep 2026.
export const GOOGLE = {
  rating: 5.0,
  count: 43,
  url: "https://maps.app.goo.gl/QdCrkYfQHvYYR3kV9",
  embed: "https://www.google.com/maps?q=Greenfront+Lawn+%26+Landscape,+Birmingham,+AL&z=11&output=embed",
  booking: "https://clienthub.getjobber.com/hubs/486a279e-8121-42b6-8259-2af73b72fb32/public/requests/4921817/new",
};

export const REVIEW_TOPICS = [
  { label: "Punctuality", n: 6 },
  { label: "Quick response", n: 4 },
  { label: "Bush trimming", n: 4 },
  { label: "Pine straw installation", n: 3 },
  { label: "Easy to work with", n: 3 },
  { label: "Friendliness", n: 3 },
  { label: "Leaf litter pickup", n: 2 },
  { label: "Debris removal", n: 2 },
  { label: "Efficient crew", n: 2 },
  { label: "Thoroughness", n: 2 },
];

export const REVIEWS = [
  { name: "JT H.", when: "Google review", text: "I have always received prompt, professional service. Greenfront shows up as scheduled, completes the job as requested. Always treating me with respect and being willing to make minor adjustments to my specific needs all for a very reasonable price!" },
  { name: "Janette S.", when: "Google review", text: "Greenfront currently performs recurring lawncare for us and is a dependable and responsive landscape company… He returned a quote and completed the work the very next day!" },
  { name: "Chuck R.", when: "Google review", text: "He's become my \"one-call\" for anything from hauling off leaves to removing bushes to cutting low limbs off of trees. All work has exceeded my expectations." },
];

const Stars = ({ className = "w-4 h-4" }: { className?: string }) => (
  <span className="flex gap-0.5" aria-hidden>
    {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`${className} fill-primary-glow text-primary-glow`} />)}
  </span>
);

/** Circular Google rating seal */
export const RatingOrb = () => (
  <a href={GOOGLE.url} target="_blank" rel="noopener noreferrer" className="group relative flex h-44 w-44 shrink-0 items-center justify-center" aria-label={`Rated ${GOOGLE.rating.toFixed(1)} out of 5 from ${GOOGLE.count} Google reviews`}>
    <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full animate-[spin_28s_linear_infinite]" aria-hidden>
      <defs><path id="orb-circle" d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" /></defs>
      <text className="fill-current text-glass/60" style={{ fontSize: 12, letterSpacing: 4.2, fontWeight: 600 }}>
        <textPath href="#orb-circle">GOOGLE REVIEWS · BIRMINGHAM, AL · GOOGLE REVIEWS · BIRMINGHAM, AL ·</textPath>
      </text>
    </svg>
    <span className="absolute inset-7 rounded-full glass-panel glass-shine" />
    <span className="absolute inset-7 rounded-full ring-1 ring-primary-glow/40 animate-ping [animation-duration:3.5s]" />
    <span className="relative text-center text-glass">
      <span className="block font-display text-5xl leading-none">{GOOGLE.rating.toFixed(1)}</span>
      <span className="mt-1.5 flex justify-center"><Stars className="w-3 h-3" /></span>
      <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-glass/70">{GOOGLE.count} reviews</span>
    </span>
  </a>
);

/** Reputation section: orb, verbatim reviews, topic chips */
export const TrustSection = () => (
  <section id="reviews" className="relative overflow-hidden bg-noir grain py-24 md:py-32 text-glass">
    <div className="pointer-events-none absolute -top-40 right-0 h-[520px] w-[520px] rounded-full bg-primary-glow/10 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-40 -left-20 h-[420px] w-[420px] rounded-full bg-copper/15 blur-3xl" />
    <div className="relative mx-auto max-w-7xl px-4 md:px-8">
      <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary-glow">02 / Reputation</p>
          <h2 className="mt-4 font-display text-5xl md:text-7xl leading-[0.95] text-balance">Birmingham neighbors, <span className="italic text-primary-glow">in their words.</span></h2>
          <p className="mt-5 max-w-xl text-glass/70 text-lg">Every review below is quoted from Greenfront's public Google Business Profile — nothing edited for tone, nothing invented.</p>
        </div>
        <RatingOrb />
      </div>

      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {REVIEWS.map((r, i) => (
          <figure key={r.name} className="glass-panel group relative flex flex-col p-7 transition-transform duration-500 hover:-translate-y-2 reveal-up" style={{ animationDelay: `${i * 0.12}s` }}>
            <Quote className="h-8 w-8 text-primary-glow/60" />
            <blockquote className="mt-4 flex-1 font-display text-xl leading-snug text-glass/90">"{r.text}"</blockquote>
            <figcaption className="mt-6 flex items-center justify-between border-t border-glass/10 pt-4">
              <span>
                <span className="block text-sm font-semibold">{r.name}</span>
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] text-glass/50"><BadgeCheck className="h-3 w-3" /> {r.when}</span>
              </span>
              <Stars className="w-3.5 h-3.5" />
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-glass/50">What reviewers mention most</p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {REVIEW_TOPICS.map((t) => (
            <span key={t.label} className="inline-flex items-center gap-2 rounded-full border border-glass/15 bg-glass/5 px-4 py-2 text-sm backdrop-blur transition-colors hover:border-primary-glow/60 hover:bg-primary-glow/10">
              {t.label}<span className="rounded-full bg-primary-glow/20 px-2 text-xs font-semibold text-primary-glow">{t.n}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <a href={GOOGLE.url} target="_blank" rel="noopener noreferrer" className="glass-shine inline-flex items-center gap-2 bg-primary-glow px-6 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-noir">
          Read all {GOOGLE.count} reviews on Google <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  </section>
);

const HOURS = [null, [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], null] as const; // Sun..Sat

const useOpenStatus = () => {
  const [status, setStatus] = useState<{ open: boolean; label: string } | null>(null);
  useEffect(() => {
    const calc = () => {
      const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const h = HOURS[now.getDay()];
      const hr = now.getHours() + now.getMinutes() / 60;
      if (h && hr >= h[0] && hr < h[1]) return setStatus({ open: true, label: "Open now · until 5 PM" });
      setStatus({ open: false, label: "Closed · opens 6 AM weekdays" });
    };
    calc();
    const id = setInterval(calc, 60000);
    return () => clearInterval(id);
  }, []);
  return status;
};

/** Cinematic map + local business panel */
export const MapSection = ({ phoneTel, phoneDisplay }: { phoneTel: string; phoneDisplay: string }) => {
  const status = useOpenStatus();
  return (
    <section id="find-us" className="relative bg-noir py-24 md:py-32 text-glass overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary-glow">03 / Find us</p>
        <h2 className="mt-4 font-display text-5xl md:text-7xl leading-[0.95] text-balance">Rooted in <span className="italic text-primary-glow">Birmingham.</span></h2>

        <div className="relative mt-12 overflow-hidden border border-glass/10 shadow-deep">
          <div className="relative h-[560px] lg:h-[540px]">
            <iframe title="Greenfront Lawn & Landscape on Google Maps" src={GOOGLE.embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 h-full w-full border-0 [filter:grayscale(1)_invert(0.92)_hue-rotate(95deg)_saturate(0.6)_brightness(0.95)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,hsl(var(--noir))_100%)]" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden>
              <span className="absolute -inset-10 rounded-full border border-primary-glow/50 animate-ping [animation-duration:2.8s]" />
              <span className="absolute -inset-20 rounded-full border border-primary-glow/20 animate-ping [animation-duration:4s]" />
            </div>

            <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:w-[380px] glass-panel glass-shine p-6">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em]">
                <span className={`h-2 w-2 rounded-full ${status?.open ? "bg-primary-glow animate-pulse" : "bg-copper"}`} />
                <span className="text-glass/80">{status?.label ?? "Mon–Fri · 6 AM – 5 PM"}</span>
              </div>
              <p className="mt-3 font-display text-2xl">Greenfront Lawn & Landscape</p>
              <p className="mt-1 flex items-center gap-2 text-sm text-glass/70"><Stars className="w-3 h-3" /> 5.0 · 43 Google reviews · Lawn care service</p>
              <div className="mt-5 grid grid-cols-2 gap-2 text-sm font-semibold">
                <a href={phoneTel} className="flex items-center justify-center gap-2 bg-primary-glow px-3 py-3 text-noir"><Phone className="h-4 w-4" /> Call</a>
                <a href={GOOGLE.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 border border-glass/25 px-3 py-3 hover:bg-glass/10"><MapPin className="h-4 w-4" /> Directions</a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="glass-panel p-6">
            <Clock className="h-5 w-5 text-primary-glow" />
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-glass/50">Hours</p>
            <p className="mt-1 font-display text-xl">Mon–Fri · 6 AM – 5 PM</p>
            <p className="text-sm text-glass/60">Saturday & Sunday closed</p>
          </div>
          <div className="glass-panel p-6">
            <MapPin className="h-5 w-5 text-primary-glow" />
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-glass/50">Service area</p>
            <p className="mt-1 font-display text-xl">Birmingham, AL</p>
            <p className="text-sm text-glass/60">Including the Meadowbrook community — call to confirm your address.</p>
          </div>
          <a href={GOOGLE.booking} target="_blank" rel="noopener noreferrer" className="glass-panel group p-6 transition-colors hover:border-primary-glow/50">
            <CalendarCheck className="h-5 w-5 text-primary-glow" />
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-glass/50">Prefer online?</p>
            <p className="mt-1 flex items-center gap-2 font-display text-xl">Request service online <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></p>
            <p className="text-sm text-glass/60">Or call {phoneDisplay} — whatever's easier.</p>
          </a>
        </div>
      </div>
    </section>
  );
};

/** Quick direct-answer block for search/AI engines, placed above FAQ */
export const AnswerBlock = () => (
  <section className="bg-background py-16 md:py-20">
    <div className="mx-auto max-w-5xl px-4 md:px-8">
      <div className="relative border-l-2 border-primary pl-6 md:pl-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">The short answer</p>
        <p className="mt-4 font-display text-2xl md:text-4xl leading-snug text-balance">
          Greenfront Lawn & Landscape is an owner-led lawn care service in Birmingham, AL, rated 5.0 from 43 Google reviews. The crew handles mowing, trimming, yard cleanup, landscape design, retaining walls and hardscaping for homes and commercial properties, Monday–Friday, 6 AM–5 PM.
        </p>
      </div>
    </div>
  </section>
);