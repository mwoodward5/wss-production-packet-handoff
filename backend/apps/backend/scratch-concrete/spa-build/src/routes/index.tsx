import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, Layers, Square, Hammer, Paintbrush, Home, LayoutGrid, ShieldCheck, Clock, MapPin, Star, Phone } from "lucide-react";
import heroImg from "@/assets/hero-concrete.webp";
import flatworkImg from "@/assets/service-flatwork.webp";
import foundationsImg from "@/assets/service-foundations.webp";
import demolitionImg from "@/assets/service-demolition.webp";
import drivewaysImg from "@/assets/service-driveways.webp";
import renovationImg from "@/assets/projects/project-02.webp";
import homeRenoImg from "@/assets/projects/project-07.webp";
import flooringImg from "@/assets/projects/project-06.webp";
import { CallButton } from "@/components/CallButton";
import { TrustChips } from "@/components/TrustChips";
import { SectionHeading } from "@/components/SectionHeading";
import { ProcessSteps } from "@/components/ProcessSteps";
import { CityChips } from "@/components/CityChips";
import { FAQ } from "@/components/FAQ";
import { ContactForm } from "@/components/ContactForm";
import { InShortBlock } from "@/components/InShortBlock";
import { Marquee } from "@/components/Marquee";
import { StatCounter } from "@/components/StatCounter";
import { Testimonials } from "@/components/Testimonials";
import { TiltCard } from "@/components/TiltCard";
import { ProjectGallery } from "@/components/ProjectGallery";
import { HeroVideo } from "@/components/HeroVideo";
import { templateFaqs } from "@/lib/site";
import { faqLd, jsonLd, webPageLd } from "@/lib/schema";
import { useLiveAreas, useLiveFaqs, useLiveIdentity, useLiveServices } from "@/lib/wssc";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Concrete Contractor in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      {
        name: "description",
        content:
          "Concrete and general contracting in {{CITY}}, {{STATE}} — foundations, flatwork, driveways, demolition, renovation. Written quotes.[[NEED:PHONE]] Call {{PHONE}}.[[/NEED]][[NEED:!PHONE]] Request an estimate online.[[/NEED]]",
      },
      { property: "og:title", content: "Concrete Contractor in {{CITY}}, {{STATE}} | {{BUSINESS_NAME}}" },
      { property: "og:description", content: "Foundations, flatwork, demolition, driveways and renovation across {{CITY}}, {{STATE}} and the surrounding area." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
      { name: "twitter:title", content: "Concrete Contractor in {{CITY}}, {{STATE}}" },
      { name: "twitter:description", content: "Foundations, flatwork, demolition, driveways and renovation. Written quotes." },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/" }],
    scripts: [jsonLd(faqLd(templateFaqs)), jsonLd(webPageLd("Concrete Contractor in {{CITY}}, {{STATE}}", "Concrete and general contracting in {{CITY}}, {{STATE}}.", "/"))],
  }),
  component: HomePage,
});

const cardImages = [flatworkImg, foundationsImg, drivewaysImg, demolitionImg, renovationImg, homeRenoImg, flooringImg];
const iconCycle: React.ComponentType<{ className?: string }>[] = [Building2, Layers, Square, Hammer, Paintbrush, Home, LayoutGrid];

function HomePage() {
  const faqs = useLiveFaqs();
  const services = useLiveServices();
  const areas = useLiveAreas();
  const id = useLiveIdentity();

  // Composed marquee: the client's own name, market, and verified service
  // lines. The donor's claim strip ("Licensed & Insured", "Same-Week Site
  // Visits", "Written Workmanship Warranty", "13+ Cities") was evidence-free.
  const marqueeItems = [
    id.businessName,
    `${id.city}, ${id.state}`,
    ...services.slice(0, 5).map((s) => s.title),
  ];

  // Stat counters — composed over verified arrays, or a verified rating pair.
  const counters: { value: number; suffix?: string; label: string }[] = [];
  if (services.length > 0) counters.push({ value: services.length, label: "Service Lines" });
  if (areas.length > 0) counters.push({ value: areas.length, suffix: areas.length === 1 ? "" : "+", label: areas.length === 1 ? "Area Served" : "Areas Served" });
  if (id.rating && id.reviewCount) counters.push({ value: id.rating, suffix: "★", label: `${id.reviewCount} Reviews` });
  if (id.license) counters.push({ value: 1, suffix: "", label: "Licensed" });

  // Quick stat band — the evidence/composed replacement for the donor's
  // four-claim band; hidden entirely when nothing verified backs a tile.
  const quickStats: { icon: typeof MapPin; k: string; v: string }[] = [];
  if (id.license) quickStats.push({ icon: ShieldCheck, k: "Licensed", v: id.license.split(/[+,]/)[0].trim().slice(0, 24) });
  if (areas.length > 1) quickStats.push({ icon: MapPin, k: `${areas.length} Areas`, v: `${id.city} & surroundings` });
  if (id.rating && id.reviewCount) quickStats.push({ icon: Star, k: String(id.rating), v: `${id.reviewCount} reviews` });
  quickStats.push({ icon: Clock, k: "Written", v: "Itemized quotes" });

  return (
    <>
      {/* HERO */}
      <HeroVideo />

      {/* MARQUEE TRUST STRIP — composed, claim-free */}
      <Marquee items={marqueeItems} />

      {/* STAT COUNTERS — composed over verified arrays */}
      {counters.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-14 lg:px-6">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {counters.slice(0, 4).map((c) => (
              <StatCounter key={c.label} value={c.value} suffix={c.suffix} label={c.label} />
            ))}
          </div>
        </section>
      )}

      {/* QUICK STATS */}
      {quickStats.length > 1 && (
        <section className="border-b border-border bg-card">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-border md:grid-cols-4">
            {quickStats.slice(0, 4).map((s) => (
              <div key={s.k} className="flex items-center gap-3 bg-card px-5 py-6">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-gold"><s.icon className="h-5 w-5" /></div>
                <div>
                  <div className="font-display text-base font-semibold">{s.k}</div>
                  <div className="text-xs text-muted-foreground">{s.v}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SERVICES GRID — the live services content slot */}
      <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <SectionHeading eyebrow="What we do" title="Concrete services that hold up." subtitle="From commercial pours to a single residential driveway — same standards on every scope." />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {services.map((s, i) => {
            const Icon = iconCycle[i % iconCycle.length];
            return (
              <TiltCard key={s.title}>
                <Link
                  to={s.href}
                  className="group relative block overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant"
                >
                  <div className="aspect-[4/3] overflow-hidden">
                    <img src={cardImages[i % cardImages.length]} alt={`${s.title} contractor in {{CITY}} & the surrounding area`} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  </div>
                  <div className="p-5">
                    <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{s.short}</p>
                    <div className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                      Learn more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              </TiltCard>
            );
          })}
        </div>
      </section>

      {/* WHY US — In Short + answers */}
      <section className="bg-secondary py-20">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Why {{BUSINESS_NAME}}" title="Spec-driven concrete work, without the guesswork." />
              <InShortBlock>
                {"{{BUSINESS_NAME}}"} handles concrete and general contracting in {"{{CITY}}"}, {"{{STATE}}"} — foundations that have to be square, flatwork that has to be smooth, demolition that has to be clean. Every quote is written, itemized, and yours to compare.
              </InShortBlock>
              <ul className="mt-6 space-y-4">
                {[
                  ["Straight answers", "The phone gets answered, the scope gets written down, and the work gets finished."],
                  ["Itemized pricing", "Concrete, prep, reinforcement, finish, and haul-off each spelled out as their own line."],
                  ["Work across the area", "Projects taken on in {{CITY}} and the surrounding communities — confirm any address at quote time."],
                  ["Experienced crews", "Commercial slab, foundation, and demolition work for general contractors and direct owners alike."],
                ].map(([t, b]) => (
                  <li key={t} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                    <div className="font-display text-lg font-semibold">{t}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{b}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <h3 className="font-display text-2xl font-semibold">Quick answers</h3>
              {[
                { q: "What should I look for in a concrete contractor?", a: "A verifiable license where required, written itemized quotes, direct crews or clear subs, and references worth checking. Ask for the spec — PSI, thickness, reinforcement, joint plan — in writing." },
                { q: "Who has the best prices?", a: "Anyone can be cheapest by cutting depth, reinforcement, or prep. The number that matters is the right spec at a fair price — ask any bidder to itemize exactly what is and isn't included." },
                { q: "What makes a bid reliable?", a: "On-paper scope: sub-base prep, reinforcement grade and spacing, finish, jointing, and haul-off, each named. Vague one-line bids hide the differences that show up two summers later." },
                { q: "What's the difference between cheapest and best?", a: "The cheapest bid usually skips prep — proper sub-base, vapor barrier, reinforcement, expansion joints. Skipping those is why cheap slabs crack early." },
              ].map((it) => (
                <div key={it.q} className="rounded-2xl border border-border bg-card p-5 shadow-card">
                  <div className="font-display text-base font-semibold">{it.q}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{it.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PROCESS */}
      <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <SectionHeading eyebrow="Our Process" title="From first call to final walkthrough — five clear steps." align="center" />
        <div className="mt-12"><ProcessSteps /></div>
      </section>

      {/* SERVICE AREA */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-2 lg:px-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Service Area
            </div>
            <h2 className="mt-4 font-display text-4xl font-semibold leading-tight md:text-5xl">
              Based in {"{{CITY}}"}. Working the <span className="text-gold">surrounding area</span>.
            </h2>
            <p className="mt-4 max-w-xl text-primary-foreground/80">
              Coverage is confirmed with your address at quote time — send the location with your request and
              you'll get a straight yes or no in writing.
            </p>
            <div className="mt-6"><CityChips /></div>
            <div className="mt-8">
              <Link to="/service-area" className="inline-flex items-center gap-2 rounded-full bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-glow">
                See full service area <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/15 shadow-elegant">
            {id.businessName ? (
              <iframe
                src={`https://www.google.com/maps?q=${encodeURIComponent(`${id.businessName} ${id.city}`)}&output=embed`}
                width="100%"
                height="420"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="{{BUSINESS_NAME}} service area map"
              />
            ) : (
              <div className="grid h-[420px] place-items-center bg-mesh-animated text-sm text-primary-foreground/60">
                Service area map
              </div>
            )}
          </div>
        </div>
      </section>

      {/* PROJECT GALLERY — the twelve photo slots */}
      <ProjectGallery />

      {/* TESTIMONIALS — verified reviews only, no fake praise */}
      <Testimonials />

      {/* LONG-FORM AUTHORITY BODY */}
      <section className="mx-auto max-w-4xl px-4 py-20 lg:px-6">
        <SectionHeading
          eyebrow="{{CITY}}, {{STATE}}"
          title="A concrete contractor built for spec-driven work"
        />
        <div data-speakable className="mt-8 space-y-5 text-lg leading-relaxed text-foreground">
          <p>
            {"{{BUSINESS_NAME}}"} is a concrete and general contracting company working out of {"{{CITY}}"},
            {" {{STATE}}"}. The work spans{" "}
            <Link to="/foundations-excavation" className="font-semibold text-foreground underline-offset-4 hover:underline">foundations and footings</Link>,
            {" "}<Link to="/commercial-concrete" className="font-semibold text-foreground underline-offset-4 hover:underline">commercial slabs and ADA ramps</Link>,
            {" "}<Link to="/flatwork-driveways" className="font-semibold text-foreground underline-offset-4 hover:underline">driveways, sidewalks and patios</Link>, and{" "}
            <Link to="/concrete-demolition" className="font-semibold text-foreground underline-offset-4 hover:underline">concrete demolition with haul-off</Link>{" "}
            — quoted as one scope when the project calls for it.
          </p>
          <p>
            Good concrete is decided before the truck arrives. Sub-base compaction, moisture protection,
            reinforcement grade and spacing, joint layout, and a finish suited to how the surface will actually
            be used — that is the difference between a slab that performs for decades and one that cracks the
            first summer. Climate matters too: hot-weather pours need temperature management and cure
            protection, and wet season work needs scheduling that respects the forecast.
          </p>
          <p>
            Every quote from this page is written and itemized — concrete strength, slab thickness, reinforcement
            schedule, sub-base prep, finish, joint plan, and haul-off each named — so two bids can be compared
            line against line instead of price tag against price tag.{" "}
            <Link to="/contact" className="font-semibold text-foreground underline-offset-4 hover:underline">Send a few details</Link>
            {" "}and the response comes back in writing.
          </p>
        </div>
      </section>

      {/* FAQ — the live faqs content slot */}
      <section className="bg-secondary py-20">
        <div className="mx-auto max-w-4xl px-4 lg:px-6">
          <SectionHeading eyebrow="FAQ" title="Common questions about working with us" align="center" />
          <div className="mt-10"><FAQ items={faqs} /></div>
        </div>
      </section>

      {/* CONTACT CTA — the in-page lead route (phone-optional fallback target) */}
      <section id="estimate" className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SectionHeading eyebrow="Get a Quote" title="Tell us about your project." subtitle="A written response with next steps — no pressure, no obligation." />
            <div className="mt-6 space-y-3 text-sm">
              {id.phone && (
                <a href={`tel:${id.phoneDigits ? `+1${id.phoneDigits.replace(/^1/, "")}` : id.phone}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
                  <Phone className="h-5 w-5 text-gold" />
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Call us</div>
                    <div className="font-display text-lg font-semibold">{id.phone}</div>
                  </div>
                </a>
              )}
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Based in</div>
                <div className="font-display text-lg font-semibold">{"{{CITY}}"}, {"{{STATE}}"}</div>
              </div>
              <div className="pt-2"><TrustChips /></div>
            </div>
          </div>
          <div className="lg:col-span-3">
            <ContactForm compact />
          </div>
        </div>
      </section>
    </>
  );
}
