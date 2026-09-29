import { useMemo, useState } from "react";
import { Phone, Mail, MapPin, Leaf, Scissors, TreePine, Hammer, Sparkles, Sun, Snowflake, CloudRain, ChevronDown, ArrowRight, Check, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
const logo = "{{LOGO_URL}}";
import heroLawn from "@/assets/hero-lawn.jpg";
import landscapeDesign from "@/assets/landscape-design.jpg";
import lawnCare from "@/assets/lawn-care.jpg";
import seasonal from "@/assets/seasonal.jpg";
import brickHouse from "@/assets/brick-house.jpg";
import truck from "@/assets/truck.jpg";
import hardscape from "@/assets/hardscape.jpg";
import grassTexture from "@/assets/grass-texture.jpg";

const PHONE_DISPLAY = "[[NEED:PHONE]]{{PHONE}}[[/NEED]]";
const PHONE_TEL = "[[NEED:PHONE_DIGITS]]tel:{{PHONE_DIGITS}}[[/NEED]]";
const EMAIL = "[[NEED:EMAIL]]{{EMAIL}}[[/NEED]]";
const EMAIL_HREF = `[[NEED:EMAIL]]mailto:${EMAIL}[[/NEED]]`;
// Optional headline line C (a VERIFIED rating sentence composed by the engine,
// e.g. "4.9 stars across 212 reviews."). Blank collapses the whole construct
// at render -- never an invented differentiator.
const HERO_LINE_C = "{{HERO_LINE_C}}";
// The verified review profile. Blank (no verified profile) collapses the
// review-ask card; the NEED phrase strips to "" at hydration.
const REVIEW_PROFILE = "[[NEED:PROFILE_URL]]{{PROFILE_URL}}[[/NEED]]";

const services = [
  { icon: Scissors, title: "Lawn Mowing", desc: "Crisp, even cuts on a schedule that keeps your turf healthy through the {{CITY}} growing season." },
  { icon: Leaf, title: "Lawn Trimming & Edging", desc: "Clean lines along walks, beds and drives — the detail work that makes a yard look cared for." },
  { icon: Sparkles, title: "Lawn Care Service", desc: "Recurring lawn care built around your turf type, sun exposure and how you actually use your yard." },
  { icon: Sun, title: "Lawn Maintenance", desc: "Ongoing lawn maintenance and lawn services so your property stays sharp week after week." },
  { icon: TreePine, title: "Landscape Design", desc: "Custom landscape design that reflects your home's character and the way you live outside." },
  { icon: Leaf, title: "Landscape Maintenance", desc: "Bed care, pruning, mulching and plant health for landscapes that mature beautifully." },
  { icon: Hammer, title: "Retaining Walls", desc: "Engineered retaining walls that solve grade problems and frame planting beds with stone." },
  { icon: Hammer, title: "Hardscaping Services", desc: "Walkways, patios and stonework integrated cleanly with planting and lawn." },
  { icon: CloudRain, title: "Yard Cleanup", desc: "Spring and fall yard cleanup — leaves, storm debris, beds reset for the next season." },
];

const gallery = [
  { src: lawnCare, alt: "Lush green lawn after professional lawn care service" },
  { src: landscapeDesign, alt: "Custom landscape design with mature plantings" },
  { src: brickHouse, alt: "Brick home with maintained landscape" },
  { src: hardscape, alt: "Stone retaining wall with layered plantings" },
  { src: seasonal, alt: "Seasonal yard cleanup with truck and leaves" },
  { src: heroLawn, alt: "Striped mowing pattern on a {{CITY}} lawn" },
];

const seasons = [
  { icon: Leaf, name: "Spring", body: "Cleanup, pre-emergent, fresh mulch, first cuts. Beds reset and turf woken up." },
  { icon: Sun, name: "Summer", body: "Weekly mowing, sharp edging, irrigation checks and bed weeding through peak growth." },
  { icon: CloudRain, name: "Fall", body: "Leaf removal, overseeding for cool-season repair, pruning and bed prep." },
  { icon: Snowflake, name: "Winter", body: "Dormant pruning, hardscape touch-ups and design planning for the year ahead." },
];

const faqs = [
  { q: "What areas do you serve?", a: "We provide lawn care service in {{CITY}}, {{STATE}} and the surrounding area, and the nearby neighborhoods." },
  { q: "What lawn services do you offer?", a: "Lawn mowing, lawn trimming, edging, yard cleanup, fertilization, landscape design, landscape maintenance, retaining walls and hardscaping services." },
  { q: "How do I get an estimate?", a: "[[NEED:PHONE]]Call {{PHONE}} or email {{EMAIL}} with your address and the services you're interested in.[[/NEED]][[NEED:!PHONE]]Send your address and the services you're interested in through the estimate form — we respond within one business day.[[/NEED]]" },
  { q: "Do you offer recurring lawn maintenance?", a: "Yes. We schedule weekly and bi-weekly lawn maintenance routes throughout the {{CITY}} area during the growing season." },
  { q: "Do you build retaining walls and hardscapes?", a: "Yes. We design and install retaining walls, walkways, and other hardscape features as part of larger landscape projects." },
];

// WSS CONTENT BRIDGE — the mirror engine injects the prospect's VERIFIED
// services and faqs via window.__WSS_CONTENT__ (a JSON island placed ahead of
// this bundle's script tag). Present, a real client build renders only their
// verified work — never these template defaults. Absent (the donor template
// previewing standalone), the design's own defaults render exactly as built.
const WSSC: { services?: { name: string; description?: string }[]; faqs?: { q: string; a: string }[]; reviews?: { name?: string; author?: string; city?: string; text?: string; rating?: number | string }[] } =
  ((typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__WSS_CONTENT__) as typeof WSSC) || {};
const defaultServices = services;
const liveServices = WSSC.services && WSSC.services.length
  ? WSSC.services.map((s, i) => ({
      icon: defaultServices[i % defaultServices.length].icon,
      title: s.name,
      desc: s.description || defaultServices[i % defaultServices.length].desc,
    }))
  : defaultServices;
const liveFaqs = WSSC.faqs && WSSC.faqs.length ? WSSC.faqs : faqs;
// VERIFIED REVIEWS ONLY (truth law). The island's reviews arrive from the
// engine's verified review payload; there are NO template fallback reviews --
// with none published the section renders the honest review-ask card (only
// when a verified profile exists), else it collapses entirely.
const liveReviews = Array.isArray(WSSC.reviews)
  ? WSSC.reviews
      .map((r0) => {
        const r = (r0 || {}) as { name?: unknown; author?: unknown; city?: unknown; text?: unknown; rating?: unknown; avatarUrl?: unknown; publishedAt?: unknown };
        const name = (typeof r.name === "string" && r.name.trim()) || (typeof r.author === "string" && r.author.trim()) || "";
        // A face renders ONLY from the reviewer's own verified Google photo
        // (the same googleusercontent gate the engine applies); anything else
        // falls back to an initials monogram. Never a stock face.
        const avatarUrl = typeof r.avatarUrl === "string" && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(r.avatarUrl) ? r.avatarUrl : "";
        const rating = Math.max(0, Math.min(5, Math.round(Number(r.rating)) || 0));
        return {
          name,
          city: typeof r.city === "string" ? r.city.trim() : "",
          text: typeof r.text === "string" ? r.text.trim() : "",
          rating,
          avatarUrl,
          initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(""),
          // "Google" renders only when the review carries fields that ONLY the
          // verified Google lane emits (a rating numeral, a verified reviewer
          // face, or a publish date). Intake-lane testimonials get no source
          // badge -- a label we cannot prove is a label we do not print.
          fromGoogle: rating > 0 || Boolean(avatarUrl) || (typeof r.publishedAt === "string" && r.publishedAt.trim() !== ""),
        };
      })
      .filter((r) => r.text)
      .slice(0, 6)
  : [];


const SeasonalPlanner = () => {
  const [season, setSeason] = useState<"Spring" | "Summer" | "Fall" | "Winter">("Spring");
  const [size, setSize] = useState<"Small" | "Medium" | "Large">("Medium");
  const [focus, setFocus] = useState<string[]>(["Lawn Care"]);

  const toggle = (f: string) =>
    setFocus((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const plan = useMemo(() => {
    const base: Record<string, string[]> = {
      Spring: ["Yard cleanup & debris haul", "Pre-emergent + first fertilization", "Bed edging & fresh mulch"],
      Summer: ["Weekly mowing & trimming", "Bed weeding & pruning", "Irrigation walk-through"],
      Fall: ["Leaf removal", "Overseed cool-season areas", "Final fertilization"],
      Winter: ["Dormant pruning", "Hardscape repair & cleaning", "Design planning for next year"],
    };
    const extras: string[] = [];
    if (focus.includes("Landscape Design")) extras.push("Concept sketch & planting plan review");
    if (focus.includes("Hardscaping")) extras.push("Walkway / retaining wall scoping");
    if (focus.includes("Maintenance")) extras.push("Add to recurring maintenance route");
    const cadence = size === "Small" ? "Bi-weekly visits" : size === "Medium" ? "Weekly visits" : "Weekly + dedicated bed days";
    return { items: [...base[season], ...extras], cadence };
  }, [season, size, focus]);

  const Pill = ({ active, children, onClick }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-soft"
          : "bg-background text-foreground border-border hover:border-primary/40"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-3xl bg-card shadow-deep border border-border/60 overflow-hidden">
      <div className="grid lg:grid-cols-5">
        <div className="lg:col-span-3 p-8 md:p-10 space-y-7">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Seasonal Property Planner</p>
            <h3 className="font-display text-3xl md:text-4xl mt-2 text-balance">
              Build a care rhythm tuned to your yard.
            </h3>
            <p className="text-muted-foreground mt-3">
              Tell us about your property and we'll outline what your lawn and landscape need next.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground/80">Season</p>
            <div className="flex flex-wrap gap-2">
              {(["Spring", "Summer", "Fall", "Winter"] as const).map((s) => (
                <Pill key={s} active={season === s} onClick={() => setSeason(s)}>{s}</Pill>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground/80">Property size</p>
            <div className="flex flex-wrap gap-2">
              {(["Small", "Medium", "Large"] as const).map((s) => (
                <Pill key={s} active={size === s} onClick={() => setSize(s)}>{s}</Pill>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground/80">What matters most</p>
            <div className="flex flex-wrap gap-2">
              {["Lawn Care", "Landscape Design", "Hardscaping", "Maintenance"].map((f) => (
                <Pill key={f} active={focus.includes(f)} onClick={() => toggle(f)}>{f}</Pill>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-leaf-gradient text-primary-foreground p-8 md:p-10 flex flex-col">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase opacity-80">Your plan · {season}</p>
          <p className="font-display text-2xl mt-2">{plan.cadence}</p>
          <ul className="mt-6 space-y-3 flex-1">
            {plan.items.map((it) => (
              <li key={it} className="flex items-start gap-3 text-sm">
                <Check className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{it}</span>
              </li>
            ))}
          </ul>
          <a href={EMAIL_HREF} className="mt-6 inline-flex items-center justify-center gap-2 bg-background text-foreground rounded-full px-5 py-3 font-semibold hover:bg-cream transition-colors">
            Send this plan <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
};

const Index = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky top bar */}
      <header className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-background/80 border-b border-border/60">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <img src={logo} alt="{{BUSINESS_NAME}}" className="h-10 w-auto" />
            <span className="hidden sm:block font-display font-semibold text-lg">{"{{BUSINESS_NAME}}"}</span>
          </a>
          {/* NAV (2026-08-20): every item maps to a section id that actually
              renders. The old "Lawn Care" (#lawn-care) and "Landscape"
              (#landscape) anchors pointed at ids that never existed in the
              compiled page (measured on the live Absolute Lawn Care build) --
              the only real anchors are top/services/gallery/reviews/planner/
              estimate/faq. Reviews is conditional exactly like its section. */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-foreground/80">
            <a href="#services" className="hover:text-primary">Services</a>
            <a href="#gallery" className="hover:text-primary">Work</a>
            {(liveReviews.length > 0 || REVIEW_PROFILE) && (
              <a href="#reviews" className="hover:text-primary">Reviews</a>
            )}
            <a href="#planner" className="hover:text-primary">Planner</a>
            <a href="#estimate" className="hover:text-primary">Contact</a>
            <a href="#faq" className="hover:text-primary">FAQ</a>
          </nav>
          {/* PHONE PILL (2026-08-20): fill and ink read from ONE pair so no
              theme override can split them (the live light-mode pill rendered
              dark-on-dark when the theme pass repointed the primary pair
              asymmetrically). The engine's slab pair is AA-proven per theme;
              standalone falls back to the design's own primary pair. Hover
              shifts brightness, never the pair. */}
          <a href={PHONE_TEL} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all bg-[hsl(var(--wss-slab,var(--primary)))] text-[hsl(var(--wss-slab-ink,var(--primary-foreground)))] hover:brightness-110">
            <Phone className="w-4 h-4" /> <span className="hidden sm:inline">{PHONE_DISPLAY}</span><span className="sm:hidden">Call</span>
          </a>
        </div>
      </header>

      {/* HERO */}
      {/* HERO */}
      <section id="top" className="relative pt-16 min-h-screen flex items-center overflow-hidden bg-[hsl(140_45%_8%)]">
        {/* Cinematic background image with depth-of-field */}
        <img
          src={heroLawn}
          alt="Morning light across a manicured {{CITY}} lawn with soft depth of field"
          className="absolute inset-0 w-full h-full object-cover scale-105"
          width={1920}
          height={1280}
        />
                  {/* THE HERO VIDEO RUNG (owner's order, 2026-08-17): hidden until the
              ladder runtime arms a rung whose bytes shipped — client clip first,
              WSS clip second. The photograph beneath is the poster; reduced
              motion never arms it. */}
          <video
            data-hero-video="1"
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            hidden
            aria-hidden="true"
          />
        {/* Morning light wash */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_75%_15%,hsl(48_90%_75%/0.45),transparent_55%)]" />
        <div className="absolute inset-0 bg-hero-gradient" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />

        {/* Topographic contour lines */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.18] mix-blend-screen pointer-events-none" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <radialGradient id="topo" cx="60%" cy="40%" r="70%">
              <stop offset="0%" stopColor="hsl(96 60% 70%)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="hsl(96 60% 70%)" stopOpacity="0" />
            </radialGradient>
          </defs>
          {Array.from({ length: 12 }).map((_, i) => (
            <ellipse key={i} cx="950" cy="500" rx={120 + i * 95} ry={70 + i * 55} fill="none" stroke="url(#topo)" strokeWidth="1" />
          ))}
        </svg>

        {/* Leaf-vein texture overlay */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.08] pointer-events-none" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g stroke="hsl(96 50% 80%)" fill="none" strokeWidth="0.6">
            <path d="M0 600 Q 200 400 400 300 T 800 0" />
            <path d="M50 600 Q 220 380 420 280 T 800 -20" />
            {Array.from({ length: 14 }).map((_, i) => (
              <path key={i} d={`M${100 + i * 50} ${600 - i * 25} Q ${180 + i * 50} ${500 - i * 25} ${260 + i * 50} ${480 - i * 25}`} />
            ))}
          </g>
        </svg>

        {/* Soft landscape-plan grid overlay */}
        <svg className="absolute right-0 bottom-0 w-[55%] h-[55%] opacity-[0.12] pointer-events-none" viewBox="0 0 400 400" aria-hidden="true">
          <defs>
            <pattern id="plan" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0H0V24" fill="none" stroke="hsl(48 80% 80%)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="400" height="400" fill="url(#plan)" />
          <circle cx="120" cy="240" r="60" fill="none" stroke="hsl(48 80% 80%)" strokeWidth="1" strokeDasharray="3 3" />
          <path d="M40 320 Q 180 200 360 280" fill="none" stroke="hsl(48 80% 80%)" strokeWidth="1" />
        </svg>

        {/* Floating leaf shadows */}
        <div className="absolute top-[18%] left-[8%] w-40 h-40 rounded-[60%_40%_55%_45%/55%_45%_60%_40%] bg-[hsl(110_45%_25%/0.35)] blur-2xl animate-leaf-float pointer-events-none" />
        <div className="absolute bottom-[14%] right-[12%] w-56 h-56 rounded-[45%_55%_40%_60%/60%_45%_55%_40%] bg-[hsl(96_55%_45%/0.25)] blur-3xl animate-leaf-float [animation-delay:1.5s] pointer-events-none" />

        {/* Organic bed-shape panel behind headline */}
        <svg className="absolute left-[-4%] top-[20%] w-[70%] h-[60%] opacity-95 pointer-events-none" viewBox="0 0 600 400" aria-hidden="true">
          <defs>
            <linearGradient id="bed1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(140 50% 10%)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="hsl(110 40% 18%)" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="bed2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(38 55% 52%)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(38 55% 52%)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M-20 120 Q 100 40 260 70 Q 440 100 520 220 Q 560 320 380 360 Q 180 400 60 320 Q -40 240 -20 120 Z" fill="url(#bed1)" />
          <path d="M40 260 Q 160 200 300 230 Q 440 260 480 320 Q 460 360 320 360 Q 160 360 80 320 Z" fill="url(#bed2)" />
        </svg>

        <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-28 grid lg:grid-cols-12 gap-10 items-center w-full">
          <div className="lg:col-span-7 text-primary-foreground animate-fade-up">
            <span className="inline-flex items-center gap-2 bg-background/15 backdrop-blur border border-primary-foreground/20 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide">
              <Leaf className="w-3.5 h-3.5" /> {"{{CITY}}"}, {"{{STATE}}"}
            </span>
            {/* THE CLIENT'S OWN HEADLINE (2026-08-19). The donor's old baked
                sentence ("Lawn care service in {city}, {state} - designed
                around your property") stamped the city but could never carry
                the client's name or motto, and the live sameness gate refused
                it: rendered_h1_not_client_derived. The engine composes line A
                (their proven motto, else their business name), line B (trade +
                market city) and line C (a verified rating sentence, blank when
                unproven) -- identity-copy.js owns the words; this h1 only
                lends them the design's type. The <br /> after line A is the
                mobile-fold contract: slogan-led builds hide everything after
                the first <br /> on a phone. */}
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl mt-6 leading-[1.02] text-balance [text-shadow:0_4px_30px_hsl(140_50%_5%/0.55)]">
              {"{{HERO_LINE_A}}"}
              <br />
              <em className="not-italic relative inline-block text-primary-foreground text-4xl md:text-5xl lg:text-6xl">
                <span className="relative z-10">{"{{HERO_LINE_B}}"}</span>
                <svg className="absolute left-0 -bottom-2 w-full h-4 z-0" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M2 14 Q 80 2 160 10 T 298 8" fill="none" stroke="hsl(96 65% 55%)" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </em>
              {HERO_LINE_C && <br />}
              {HERO_LINE_C && (
                <span className="block mt-4 text-lg md:text-xl font-normal text-primary-foreground/85">
                  {HERO_LINE_C}
                </span>
              )}
            </h1>
            <p className="mt-6 text-lg md:text-xl max-w-2xl text-primary-foreground/90">
              {"{{BUSINESS_NAME}}"} brings thoughtful design, reliable maintenance and a real eye for detail to lawns and landscapes across the {"{{CITY}}"} area.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={PHONE_TEL} className="group relative overflow-hidden inline-flex items-center gap-2 bg-primary-glow text-foreground rounded-full px-6 py-3.5 font-semibold shadow-soft hover:bg-primary-glow/90 transition-all">
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-sun-glint pointer-events-none" />
                <Phone className="w-4 h-4 relative" /> <span className="relative">Call {PHONE_DISPLAY}</span>
              </a>
              <a href="#estimate" className="group relative overflow-hidden inline-flex items-center gap-2 bg-background/15 backdrop-blur border border-primary-foreground/30 text-primary-foreground rounded-full px-6 py-3.5 font-semibold hover:bg-background/25 transition-all">
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-sun-glint [animation-delay:1.2s] pointer-events-none" />
                <Mail className="w-4 h-4 relative" /> <span className="relative">Request an estimate</span>
              </a>
            </div>
          </div>

          {/* Property Care Planner widget */}
          <div className="lg:col-span-5 animate-fade-up [animation-delay:200ms]">
            <div className="relative rounded-[2rem] bg-background/10 backdrop-blur-xl border border-primary-foreground/20 p-6 md:p-7 shadow-deep">
              <div className="absolute -top-3 left-6 bg-primary-glow text-foreground text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-1 rounded-full">
                Property Care Planner
              </div>
              <p className="text-primary-foreground/90 text-sm mt-2 mb-4">
                A starting blueprint for your lawn & landscape — pick the care your property needs.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { icon: Scissors, label: "Lawn Care" },
                  { icon: Leaf, label: "Mowing" },
                  { icon: Sparkles, label: "Trimming" },
                  { icon: TreePine, label: "Landscape Design" },
                  { icon: Hammer, label: "Hardscaping" },
                  { icon: CloudRain, label: "Cleanup" },
                ].map(({ icon: I, label }) => (
                  <div key={label} className="group flex items-center gap-2.5 rounded-xl bg-background/15 hover:bg-background/25 border border-primary-foreground/15 px-3 py-2.5 transition-colors cursor-default">
                    <span className="w-8 h-8 rounded-lg bg-leaf-gradient flex items-center justify-center shrink-0">
                      <I className="w-4 h-4 text-primary-foreground" />
                    </span>
                    <span className="text-primary-foreground text-sm font-medium leading-tight">{label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-[hsl(38_55%_52%/0.25)] border border-[hsl(38_55%_70%/0.35)] px-3 py-2.5">
                <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
                  <Sun className="w-4 h-4 text-accent-foreground" />
                </span>
                <span className="text-primary-foreground text-sm font-medium">Seasonal Services — spring through winter</span>
              </div>
              <a href="#planner" className="mt-5 flex items-center justify-between text-primary-foreground text-sm font-semibold hover:text-primary-glow transition-colors">
                Build my full plan <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Curved organic transition */}
        <svg className="absolute bottom-0 inset-x-0 w-full h-16 md:h-24 text-primary" viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 60 Q 240 10 520 50 T 1080 60 T 1440 40 L 1440 120 L 0 120 Z" fill="currentColor" />
        </svg>
      </section>

      {/* CTA STRIP */}
      <section className="bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 grid sm:grid-cols-3 gap-4 items-center">
          <a href={PHONE_TEL} className="flex items-center gap-3 group">
            <span className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center"><Phone className="w-4 h-4" /></span>
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">Call</p>
              <p className="font-semibold group-hover:underline">{PHONE_DISPLAY}</p>
            </div>
          </a>
          <a href={EMAIL_HREF} className="flex items-center gap-3 group">
            <span className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center"><Mail className="w-4 h-4" /></span>
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">Email</p>
              <p className="font-semibold group-hover:underline break-all">{EMAIL}</p>
            </div>
          </a>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center"><MapPin className="w-4 h-4" /></span>
            <div>
              <p className="text-xs uppercase tracking-wider opacity-70">Service area</p>
              <p className="font-semibold">{"{{CITY}}"}, {"{{STATE}}"}</p>
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="py-24 md:py-32 bg-earth-gradient">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">What we do</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">
              Lawn and landscape services, done with care.
            </h2>
            <p className="mt-5 text-muted-foreground text-lg">
              From weekly lawn mowing to retaining walls and full landscape design — one team, one standard.
            </p>
          </div>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {liveServices.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="group bg-card rounded-3xl p-7 border border-border/60 hover:shadow-soft transition-all hover:-translate-y-1">
                <div className="w-12 h-12 rounded-2xl bg-leaf-gradient text-primary-foreground flex items-center justify-center mb-5">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl">{title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GALLERY / TRANSFORMATION */}
      <section id="gallery" className="py-24 md:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6 mb-12">
            <div className="max-w-xl">
              <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Property transformation</p>
              <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">Real lawns, real landscapes.</h2>
            </div>
            <p className="text-muted-foreground max-w-md">
              A look at the kind of work we do across {"{{CITY}}"} — lush turf, layered plantings and stonework that holds up.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {gallery.map((g, i) => (
              <div
                key={g.src}
                className={`relative overflow-hidden rounded-3xl bg-muted ${
                  i === 0 ? "col-span-2 row-span-2 aspect-square md:aspect-[4/5]" : "aspect-square"
                }`}
              >
                <img
                  src={g.src}
                  alt={g.alt}
                  loading="lazy"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY GREENFRONT */}
      <section className="py-24 md:py-32 bg-foreground text-background relative overflow-hidden">
        <img src={grassTexture} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover opacity-15" />
        <div className="relative max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary-glow uppercase">Why {"{{BUSINESS_NAME}}"}</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">
              A lawn that looks loved — week after week.
            </h2>
            <p className="mt-6 text-background/80 text-lg leading-relaxed">
              We treat your outdoor space as an extension of your home. That means showing up on schedule, sweating the small details, and building a property plan that holds up through every {"{{CITY}}"} season.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 gap-5">
              {[
                ["Local to {{CITY}}", "Routes built around the {{CITY}} area."],
                ["Detail-driven", "Sharp edging, clean lines, no shortcuts."],
                ["One team, one standard", "Same crew, same quality, every visit."],
                ["Design + maintenance", "Plan it, plant it, maintain it — under one roof."],
              ].map(([t, d]) => (
                <div key={t} className="border border-background/15 rounded-2xl p-5">
                  <p className="font-display text-lg">{t}</p>
                  <p className="text-sm text-background/70 mt-1">{d}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <img
              src={truck}
              alt="Lawn-care equipment ready for a {{CITY}} route"
              loading="lazy"
              className="rounded-3xl shadow-deep w-full object-cover aspect-[4/5]"
            />
            <div className="absolute -bottom-6 -left-6 hidden md:block bg-primary-glow text-foreground rounded-2xl p-5 shadow-deep max-w-[220px]">
              <p className="font-display text-2xl leading-tight">Mon–Fri</p>
              <p className="text-sm">6:00 AM – 5:00 PM</p>
            </div>
          </div>
        </div>
      </section>

      {/* REVIEWS -- verified island reviews only (truth law). The engine's
          content island (window.__WSS_CONTENT__.reviews) is the ONLY source of
          quotes; there are no template testimonials to fall back to. With no
          verified reviews but a verified profile, the honest review-ask card
          renders; with neither, the whole section collapses. Declared in
          BOILERPLATE.json renders[] so the engine does not append its own
          duplicate reviews block. */}
      {(liveReviews.length > 0 || REVIEW_PROFILE) && (
        <section id="reviews" className="py-24 md:py-32 bg-secondary/40">
          <div className="max-w-7xl mx-auto px-4 md:px-8">
            <div className="max-w-2xl mb-12">
              <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">What neighbors say</p>
              <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">Reviews from the {"{{CITY}}"} area.</h2>
            </div>
            {liveReviews.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {liveReviews.map((r, i) => (
                  <figure key={i} className="bg-card rounded-3xl p-7 border border-border/60 flex flex-col">
                    <div className="flex items-center gap-3">
                      {r.avatarUrl ? (
                        <img
                          src={r.avatarUrl}
                          alt={r.name ? `${r.name} profile photo` : "Reviewer profile photo"}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <span aria-hidden className="w-10 h-10 rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] flex items-center justify-center font-display text-sm font-semibold shrink-0">
                          {r.initials || "•"}
                        </span>
                      )}
                      <div className="min-w-0">
                        {r.name && <p className="font-semibold text-sm truncate">{r.name}</p>}
                        {r.rating > 0 && (
                          <div className="flex gap-0.5 text-primary" aria-label={`${r.rating} out of 5 stars`}>
                            {Array.from({ length: r.rating }).map((_, j) => (
                              <Star key={j} className="w-3.5 h-3.5 fill-current" />
                            ))}
                          </div>
                        )}
                      </div>
                      {r.fromGoogle && (
                        <span className="ml-auto shrink-0 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground border border-border rounded-full px-2 py-0.5">
                          Google
                        </span>
                      )}
                    </div>
                    <blockquote className="mt-4 text-muted-foreground text-sm leading-relaxed flex-1">
                      &ldquo;{r.text}&rdquo;
                    </blockquote>
                    {r.city && <figcaption className="mt-3 text-xs text-muted-foreground">{r.city}</figcaption>}
                  </figure>
                ))}
              </div>
            ) : (
              <div className="max-w-2xl bg-card rounded-3xl p-8 border border-border/60">
                <p className="text-muted-foreground leading-relaxed">
                  Worked with us on your lawn or landscape? An honest Google review helps neighbors in the {"{{CITY}}"} area find a crew that treats their yard right.
                </p>
                <a
                  href={REVIEW_PROFILE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-6 py-3 font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Star className="w-4 h-4" /> Leave a Google review
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* MAP / GOOGLE BUSINESS -- moved above the planner 2026-08-20 (owner
          walkthrough): the Find/contact surface earns its place higher on the
          page. */}
      <section id="estimate" className="py-24 md:py-32 bg-background">
        <div className="max-w-7xl mx-auto px-4 md:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Find us</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">Serving the {"{{CITY}}"} area.</h2>
            <p className="mt-5 text-muted-foreground text-lg">
              Based in the {"{{CITY}}"}, {"{{STATE}}"} area with a focus on the  community and nearby neighborhoods. Reach out and we'll let you know if your address is on the route.
            </p>
            {/* Obsidian contact chips (owner walkthrough 2026-08-20): dark
                glass pills on a slow staggered drift; the drift is suppressed
                entirely under reduced motion. The old maps link fell back to a
                dead #area anchor when no verified profile existed -- now the
                chip simply does not render without one. */}
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={PHONE_TEL} className="wss-float-chip inline-flex items-center gap-2.5 rounded-full bg-foreground/90 text-background px-5 py-3 text-sm font-semibold shadow-deep backdrop-blur hover:bg-foreground transition-colors">
                <Phone className="w-4 h-4" /> {PHONE_DISPLAY}
              </a>
              <a href={EMAIL_HREF} className="wss-float-chip inline-flex items-center gap-2.5 rounded-full bg-foreground/90 text-background px-5 py-3 text-sm font-semibold shadow-deep backdrop-blur hover:bg-foreground transition-colors break-all">
                <Mail className="w-4 h-4" /> {EMAIL}
              </a>
              {REVIEW_PROFILE && (
                <a href={REVIEW_PROFILE} target="_blank" rel="noopener noreferrer" className="wss-float-chip inline-flex items-center gap-2.5 rounded-full bg-foreground/90 text-background px-5 py-3 text-sm font-semibold shadow-deep backdrop-blur hover:bg-foreground transition-colors">
                  <MapPin className="w-4 h-4" /> View on Google Maps
                </a>
              )}
            </div>
          </div>
          <div className="rounded-3xl overflow-hidden shadow-deep border border-border/60 aspect-[4/3]">
            <iframe
              title="{{BUSINESS_NAME}} on Google Maps"
              src="[[NEED:GEO_LAT]]https://www.google.com/maps?q={{GEO_LAT}},{{GEO_LNG}}&output=embed[[/NEED]][[NEED:!GEO_LAT]]https://www.google.com/maps?q={{CITY}},{{STATE}}&output=embed[[/NEED]]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-full border-0"
            />
          </div>
        </div>
      </section>

      {/* SEASONAL PLANNER */}
      <section id="planner" className="py-24 md:py-32 bg-earth-gradient">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Custom widget</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">Seasonal Care Rhythm</h2>
            <p className="mt-5 text-muted-foreground text-lg">
              Use the Seasonal Property Planner to sketch what your yard needs right now — then send it over.
            </p>
          </div>
          <SeasonalPlanner />

          <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {seasons.map(({ icon: Icon, name, body }) => (
              <div key={name} className="relative overflow-hidden bg-card rounded-3xl p-6 border border-border/60">
                {/* Owner walkthrough 2026-08-20: these cards read as flat dark
                    boxes on themed builds. A whisper of the seasonal
                    photograph (a photo slot, so on real builds it is the
                    client's own image) warms the surface, and the ink rides
                    the card's OWN pair so no theme pass can split it. */}
                <img src={seasonal} alt="" aria-hidden loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-[0.07] pointer-events-none" />
                <div className="relative">
                  <Icon className="w-6 h-6 text-primary mb-3" />
                  <p className="font-display text-xl text-card-foreground">{name}</p>
                  <p className="text-sm text-card-foreground/75 mt-2">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 md:py-32 bg-secondary/40">
        <div className="max-w-4xl mx-auto px-4 md:px-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase text-center">Questions</p>
          <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance text-center">Good to know.</h2>
          <Accordion type="single" collapsible className="mt-12 space-y-3">
            {liveFaqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="bg-card rounded-2xl border border-border/60 px-6">
                <AccordionTrigger className="font-display text-lg text-left hover:no-underline">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-24 md:py-32 bg-leaf-gradient text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <img src={grassTexture} alt="" aria-hidden className="w-full h-full object-cover" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 md:px-8 text-center">
          <h2 className="font-display text-4xl md:text-7xl text-balance leading-tight">
            Ready for a yard you actually look forward to seeing?
          </h2>
          <p className="mt-6 text-lg md:text-xl opacity-90 max-w-2xl mx-auto">
            Tell us about your property and we'll put together an estimate for the lawn and landscape services that fit.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a href={PHONE_TEL} className="inline-flex items-center gap-2 bg-background text-foreground rounded-full px-7 py-4 font-semibold shadow-deep hover:bg-cream transition-colors">
              <Phone className="w-4 h-4" /> Call {PHONE_DISPLAY}
            </a>
            <a href={EMAIL_HREF} className="inline-flex items-center gap-2 bg-foreground/10 backdrop-blur border border-primary-foreground/30 rounded-full px-7 py-4 font-semibold hover:bg-foreground/20 transition-colors">
              <Mail className="w-4 h-4" /> Email for an estimate
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-foreground text-background py-12">
        <div className="max-w-7xl mx-auto px-4 md:px-8 grid md:grid-cols-3 gap-8 items-start">
          <div className="flex items-center gap-3">
            <img src={logo} alt="{{BUSINESS_NAME}}" className="h-12 w-auto bg-background rounded-xl p-1.5" />
            <div>
              <p className="font-display text-lg">{"{{BUSINESS_NAME}}"}</p>
              <p className="text-sm text-background/60">{"{{CITY}}"}, {"{{STATE}}"}</p>
            </div>
          </div>
          <div className="text-sm space-y-2 text-background/80">
            <a href={PHONE_TEL} className="flex items-center gap-2 hover:text-primary-glow"><Phone className="w-4 h-4" /> {PHONE_DISPLAY}</a>
            <a href={EMAIL_HREF} className="flex items-center gap-2 hover:text-primary-glow break-all"><Mail className="w-4 h-4" /> {EMAIL}</a>
            <p className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Mon–Fri · 6:00 AM – 5:00 PM</p>
          </div>
          <div className="text-xs text-background/50 md:text-right">
            <p>© {new Date().getFullYear()} {"{{BUSINESS_NAME}}"}. All rights reserved.</p>
            {/* WSS attribution (owner directive 2026-08-20): tasteful, muted,
                and honest -- the mirror is built by wss-ai.com. */}
            <a href="https://wss-ai.com" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-background/40 hover:text-background/70 underline-offset-2 hover:underline">
              Built by wss-ai.com
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
