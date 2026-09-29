import { useMemo, useState } from "react";
import { Phone, Mail, MapPin, Leaf, Scissors, TreePine, Hammer, Sparkles, Sun, Snowflake, CloudRain, ChevronDown, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import logo from "@/assets/logo.png";
import heroLawn from "@/assets/hero-lawn.jpg";
import landscapeDesign from "@/assets/landscape-design.jpg";
import lawnCare from "@/assets/lawn-care.jpg";
import seasonal from "@/assets/seasonal.jpg";
import brickHouse from "@/assets/brick-house.jpg";
import truck from "@/assets/truck.jpg";
import hardscape from "@/assets/hardscape.jpg";
import grassTexture from "@/assets/grass-texture.jpg";
import heroMotion from "@/assets/greenfront-hero-motion.mp4.asset.json";
import { TrustSection, MapSection, AnswerBlock } from "@/components/TrustModules";

const PHONE_DISPLAY = "(205) 603-4987";
const PHONE_TEL = "tel:+12056034987";
const EMAIL = "greenfrontbham@gmail.com";
const EMAIL_HREF = `mailto:${EMAIL}`;

const services = [
  { icon: Scissors, title: "Lawn Mowing", desc: "Crisp, even cuts on a schedule that keeps your turf healthy through the Birmingham growing season." },
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
  { src: heroLawn, alt: "Striped mowing pattern on a Birmingham lawn" },
];

const seasons = [
  { icon: Leaf, name: "Spring", body: "Cleanup, pre-emergent, fresh mulch, first cuts. Beds reset and turf woken up." },
  { icon: Sun, name: "Summer", body: "Weekly mowing, sharp edging, irrigation checks and bed weeding through peak growth." },
  { icon: CloudRain, name: "Fall", body: "Leaf removal, overseeding for cool-season repair, pruning and bed prep." },
  { icon: Snowflake, name: "Winter", body: "Dormant pruning, hardscape touch-ups and design planning for the year ahead." },
];

const faqs = [
  { q: "What areas do you serve?", a: "We provide lawn care service in Birmingham, AL and the surrounding area, including the Meadowbrook community." },
  { q: "What lawn services do you offer?", a: "Lawn mowing, lawn trimming, edging, yard cleanup, fertilization, landscape design, landscape maintenance, retaining walls and hardscaping services." },
  { q: "How do I get an estimate?", a: "Call (205) 603-4987 or email greenfrontbham@gmail.com with your address and the services you're interested in." },
  { q: "Do you offer recurring lawn maintenance?", a: "Yes. We schedule weekly and bi-weekly lawn maintenance routes throughout the Birmingham area during the growing season." },
  { q: "Do you build retaining walls and hardscapes?", a: "Yes. We design and install retaining walls, walkways, and other hardscape features as part of larger landscape projects." },
];

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
    <Button
      onClick={onClick}
      type="button"
      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-soft"
          : "bg-background text-foreground border-border hover:border-primary/40"
      }`}
    >
      {children}
    </Button>
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
      <header className="fixed top-0 inset-x-0 z-50 bg-noir/75 backdrop-blur-2xl border-b border-glass/10 text-glass">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2">
            <img src={logo} alt="Greenfront Lawn & Landscape" className="h-10 w-auto" />
            <span className="hidden sm:block font-display text-xl">Greenfront</span>
          </a>
          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold uppercase tracking-[0.16em] text-glass/70">
            <a href="#services" className="hover:text-primary-glow transition-colors">Services</a>
            <a href="#lawn-care" className="hover:text-primary-glow transition-colors">Lawn Care</a>
            <a href="#landscape" className="hover:text-primary-glow transition-colors">Landscape</a>
            <a href="#gallery" className="hover:text-primary-glow transition-colors">Work</a>
            <a href="#reviews" className="hover:text-primary-glow transition-colors">Reviews</a>
            <a href="#find-us" className="hover:text-primary-glow transition-colors">Find us</a>
            <a href="#faq" className="hover:text-primary-glow transition-colors">FAQ</a>
          </nav>
          <a href={PHONE_TEL} className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors">
            <Phone className="w-4 h-4" /> <span className="hidden sm:inline">{PHONE_DISPLAY}</span><span className="sm:hidden">Call</span>
          </a>
        </div>
      </header>

      <section id="top" className="relative pt-16 min-h-[100svh] flex items-center overflow-hidden bg-noir grain">
        {/* Cinematic background image with depth-of-field */}
        <img
          src={heroLawn}
          alt="Morning light across a manicured Birmingham lawn with soft depth of field"
          className="absolute inset-0 w-full h-full object-cover media-zoom"
          width={1920}
          height={1280}
        />
        <video className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" autoPlay muted loop playsInline poster={heroLawn} aria-label="Morning light moving gently across a manicured Birmingham lawn">
          <source src={heroMotion.url} type="video/mp4" />
        </video>
        {/* Morning light wash */}
        <div className="absolute inset-0 bg-hero-gradient" />
        <div className="absolute inset-0 bg-gradient-to-t from-noir/90 via-transparent to-noir/30" />

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

        <div className="absolute left-[4%] bottom-0 hidden lg:block h-36 w-px editorial-rule" />
        <div className="relative max-w-[1440px] mx-auto px-4 md:px-8 py-16 md:py-24 grid lg:grid-cols-12 gap-8 items-center w-full">
          <div className="lg:col-span-7 text-glass reveal-up">
            <span className="inline-flex items-center gap-2 border-l-2 border-primary-glow pl-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary-glow">
              <Leaf className="w-3.5 h-3.5" /> Birmingham, AL · Meadowbrook area
            </span>
            <h1 className="font-display text-6xl md:text-8xl lg:text-[7.5rem] mt-7 leading-[0.82] text-balance [text-shadow:0_12px_50px_hsl(var(--noir)/0.7)]">
              Lawn care,<br /><span className="italic font-normal text-primary-glow">architected</span><br />for Birmingham.
            </h1>
            <div className="editorial-rule h-px w-44 mt-8" />
            <p className="mt-6 text-base md:text-lg max-w-xl text-glass/78 leading-relaxed">
              Greenfront Lawn & Landscape brings thoughtful design, reliable maintenance and a real eye for detail to lawns and landscapes across the Birmingham area.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={PHONE_TEL} className="glass-shine inline-flex items-center gap-2 bg-primary-glow text-noir px-7 py-4 text-sm font-bold uppercase tracking-[0.12em] shadow-soft hover:bg-glass transition-all">
                <Phone className="w-4 h-4 relative" /> <span className="relative">Call {PHONE_DISPLAY}</span>
              </a>
              <a href={EMAIL_HREF} className="inline-flex items-center gap-2 border border-glass/25 bg-noir/20 backdrop-blur-xl text-glass px-7 py-4 text-sm font-bold uppercase tracking-[0.12em] hover:bg-glass/10 transition-all">
                <Mail className="w-4 h-4 relative" /> <span className="relative">Request an estimate</span>
              </a>
            </div>
          </div>

          {/* Property Care Planner widget */}
          <div className="lg:col-span-5 reveal-up reveal-delay">
            <div className="glass-panel glass-shine relative p-6 md:p-8 border-l-2 border-l-primary-glow">
              <div className="text-primary-glow text-[10px] font-bold tracking-[0.24em] uppercase">01 / Property Care Planner</div>
              <h2 className="font-display text-3xl text-glass mt-4">Shape your property plan.</h2>
              <p className="text-glass/65 text-sm mt-2 mb-6">
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
                   <div key={label} className="group flex items-center gap-2.5 bg-noir/35 hover:bg-primary-glow/15 border border-glass/10 px-3 py-3 transition-all cursor-default">
                     <span className="w-8 h-8 border border-primary-glow/35 flex items-center justify-center shrink-0">
                       <I className="w-4 h-4 text-primary-glow" />
                    </span>
                    <span className="text-primary-foreground text-sm font-medium leading-tight">{label}</span>
                  </div>
                ))}
              </div>
               <div className="mt-3 flex items-center gap-2.5 bg-copper/25 border border-copper/40 px-3 py-3">
                 <span className="w-8 h-8 bg-copper flex items-center justify-center shrink-0">
                  <Sun className="w-4 h-4 text-accent-foreground" />
                </span>
                <span className="text-primary-foreground text-sm font-medium">Seasonal Services — spring through winter</span>
              </div>
               <a href="#planner" className="mt-6 pt-5 border-t border-glass/10 flex items-center justify-between text-glass text-xs font-bold uppercase tracking-[0.15em] hover:text-primary-glow transition-colors">
                Build my full plan <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="absolute bottom-5 right-6 hidden lg:flex items-center gap-3 text-glass/45 text-[10px] font-semibold uppercase tracking-[0.25em] [writing-mode:vertical-rl]">Explore <span className="h-20 w-px editorial-rule" /></div>
      </section>

      <div className="overflow-hidden bg-noir border-y border-glass/10 py-4 text-glass">
        <div className="marquee-track flex w-max items-center whitespace-nowrap text-xs font-semibold uppercase tracking-[0.22em]">
          {[0, 1].map((copy) => <div key={copy} className="flex items-center">{["Lawn Care", "Landscape Design", "Precision Mowing", "Hardscaping", "Seasonal Care", "Birmingham / Meadowbrook"].map((item) => <span key={`${copy}-${item}`} className="flex items-center"><Sparkles className="mx-7 h-3 w-3 text-primary-glow" />{item}</span>)}</div>)}
        </div>
      </div>

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
              <p className="font-semibold">Birmingham, AL · Meadowbrook</p>
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
            {services.map(({ icon: Icon, title, desc }) => (
              <div id={title === "Lawn Mowing" ? "lawn-care" : title === "Landscape Design" ? "landscape" : undefined} key={title} className="service-card group scroll-mt-24 bg-card p-7 border border-border/60 hover:shadow-soft transition-all duration-500 hover:-translate-y-2">
                <div className="w-12 h-12 border border-primary/25 bg-secondary text-primary flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
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
              A look at the kind of work we do across Birmingham — lush turf, layered plantings and stonework that holds up.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {gallery.map((g, i) => (
              <div
                key={g.src}
                className={`relative overflow-hidden bg-muted ${
                  i === 0 ? "col-span-2 row-span-2 aspect-square md:aspect-[4/5]" : "aspect-square"
                }`}
              >
                <img
                  src={g.src}
                  alt={g.alt}
                  loading="lazy"
                  className="w-full h-full object-cover grayscale-[15%] hover:grayscale-0 hover:scale-110 transition-all duration-1000"
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
            <p className="text-xs font-semibold tracking-[0.2em] text-primary-glow uppercase">Why Greenfront</p>
            <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance">
              A lawn that looks loved — week after week.
            </h2>
            <p className="mt-6 text-background/80 text-lg leading-relaxed">
              We treat your outdoor space as an extension of your home. That means showing up on schedule, sweating the small details, and building a property plan that holds up through every Birmingham season.
            </p>
            <div className="mt-10 grid sm:grid-cols-2 gap-5">
              {[
                ["Local to Birmingham", "Routes built around the Birmingham/Meadowbrook area."],
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
              alt="Greenfront truck and trailer ready for a Birmingham lawn route"
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
              <div key={name} className="service-card bg-card p-6 border-t-2 border-t-primary-glow border-x border-b border-border/60 hover:-translate-y-2 transition-transform duration-500">
                <Icon className="w-6 h-6 text-primary mb-3" />
                <p className="font-display text-xl">{name}</p>
                <p className="text-sm text-muted-foreground mt-2">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REVIEWS / MAP / ANSWER */}
      <TrustSection />
      <MapSection phoneTel={PHONE_TEL} phoneDisplay={PHONE_DISPLAY} />
      <AnswerBlock />

      {/* FAQ */}
      <section id="faq" className="py-24 md:py-32 bg-secondary/40">
        <div className="max-w-4xl mx-auto px-4 md:px-8">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase text-center">Questions</p>
          <h2 className="font-display text-4xl md:text-6xl mt-3 text-balance text-center">Good to know.</h2>
          <Accordion type="single" collapsible className="mt-12 space-y-3">
            {faqs.map((f, i) => (
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
            <img src={logo} alt="Greenfront Lawn & Landscape" className="h-12 w-auto bg-background rounded-xl p-1.5" />
            <div>
              <p className="font-display text-lg">Greenfront Lawn & Landscape</p>
              <p className="text-sm text-background/60">Birmingham, AL</p>
            </div>
          </div>
          <div className="text-sm space-y-2 text-background/80">
            <a href={PHONE_TEL} className="flex items-center gap-2 hover:text-primary-glow"><Phone className="w-4 h-4" /> {PHONE_DISPLAY}</a>
            <a href={EMAIL_HREF} className="flex items-center gap-2 hover:text-primary-glow break-all"><Mail className="w-4 h-4" /> {EMAIL}</a>
            <p className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Mon–Fri · 6:00 AM – 5:00 PM</p>
          </div>
          <p className="text-xs text-background/50 md:text-right">
            © {new Date().getFullYear()} Greenfront Lawn & Landscape. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;