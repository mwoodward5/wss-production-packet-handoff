import { client, gallery, aboutPhoto, serviceList, serviceHref, faqsFor, pageCopy } from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Phone, MessageSquare, ShieldCheck, Hammer, Sparkles, Wrench, PaintRoller, Layers } from "lucide-react";
const textureImg = "";
const roomWiresImg = "";
const diningBarImg = "";
const ceilingRepairImg = "";
const popcornImg = "";
const warehouseLiftImg = "";
const exhaustFanImg = "";
const bathroomPaintImg = "";
const commercialImg = "";
import { business, testimonials } from "@/lib/business";
import { jsonLdScript, ldBreadcrumbs, ldFAQ, pageMeta } from "@/lib/seo";
import { WallStudioHero } from "@/components/hero/WallStudioHero";

const FAQS = client.content.faqs.slice(0,4);

export const Route = createFileRoute("/")({
  head: () => ({scripts: FAQS.length ? [jsonLdScript(ldFAQ(FAQS))] : [], meta: pageMeta({title: client.identity.businessName + " | Home", description: client.hero.support, path: "/"})}),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <WallStudioHero />
      <ServicesGrid />
      <ProcessPanel />
      <CraftStrip />
      <CommercialBlock />
      <ReviewsBlock />
      <FAQBlock />
      <BigCTA />
    </>
  );
}

/* -------------------------------- SERVICES -------------------------------- */
function ServicesGrid() {
  const cards = client.services.slice(0,4).map((s,i)=>({to:serviceHref(s),icon:[Hammer,Layers,PaintRoller,Wrench][i%4],title:s.name,desc:s.description}));
  return (
    <section className="relative bg-background py-24 lg:py-32">
      <div className="mx-auto max-w-[1500px] px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-10 items-end">
          <div className="lg:col-span-7">
            <div className="eyebrow">What we do</div>
            <h2 className="mt-4 font-display text-[40px] lg:text-[60px] leading-[1.02] text-ink">Our <span className="italic">services.</span></h2>
          </div>
          <div className="lg:col-span-5 lg:pb-3">
            <p className="text-[17px] leading-relaxed text-foreground/75">{client.content.serviceIntro}</p>
          </div>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-sm overflow-hidden border border-border">
          {cards.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="group relative bg-card p-7 lg:p-8 hover:bg-secondary transition-colors"
            >
              <div className="flex items-center justify-between">
                <c.icon className="h-7 w-7 text-ink" strokeWidth={1.4} />
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-all group-hover:translate-x-1 group-hover:text-amber" />
              </div>
              <h3 className="mt-7 font-display text-[24px] text-ink leading-tight">{c.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-foreground/70">{c.desc}</p>
              <div className="mt-6 inline-flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.2em] text-ink/70 group-hover:text-amber">
                Explore →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- PROCESS PANEL -------------------------------- */
function ProcessPanel() {
  if (true /* No certified process-step field in supplied contract. */) return null;
  const steps = [] as {n:string;t:string;d:string}[];
  return (
    <section className="bg-secondary/60 py-24 lg:py-32 relative overflow-hidden">
      <div className="absolute inset-0 grain pointer-events-none" />
      <div className="relative mx-auto max-w-[1500px] px-6 lg:px-10">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4 lg:sticky lg:top-28 self-start">
            <div className="eyebrow">How a project starts</div>
            <h2 className="mt-4 font-display text-[40px] lg:text-[54px] leading-[1.02] text-ink">Project <span className="italic">steps.</span></h2>
            <p className="mt-5 text-foreground/75 leading-relaxed"></p>
            <div className="mt-7 inline-flex items-center gap-3 px-4 py-3 rounded-sm bg-bone border border-border">
              <ShieldCheck className="h-4 w-4 text-amber" />
              <span className="text-[13px] text-ink"></span>
            </div>
          </div>

          <div className="lg:col-span-8">
            <ol className="grid gap-px bg-border rounded-sm overflow-hidden border border-border">
              {steps.map((s) => (
                <li key={s.n} className="grid grid-cols-[80px_1fr] items-start gap-6 bg-card p-7 lg:p-8">
                  <div className="font-display text-[40px] text-amber leading-none">{s.n}</div>
                  <div>
                    <h3 className="font-display text-[22px] text-ink">{s.t}</h3>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/75">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- CRAFT STRIP (image marquee) -------------------------------- */
function CraftStrip() {
  if (!gallery.length) return null;
  const imgs = gallery.slice(0,7).map(m=>m.path);
  const tape = [...imgs, ...imgs];
  return (
    <section className="py-24 lg:py-32 bg-background">
      <div className="mx-auto max-w-[1500px] px-6 lg:px-10">
        <div className="flex items-end justify-between gap-6 mb-10">
          <div>
            <div className="eyebrow">The work itself</div>
            <h2 className="mt-3 font-display text-[36px] lg:text-[52px] text-ink leading-[1.04]">A look across a few walls.</h2>
          </div>
          <Link to="/gallery" className="hidden sm:inline-flex items-center gap-2 px-5 py-3 rounded-sm border border-border text-[13px] hover:bg-secondary">
            See full gallery <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="relative overflow-hidden">
        <div className="flex w-max marquee gap-5 px-6 lg:px-10">
          {tape.map((src, i) => (
            <div key={i} className="relative h-[320px] lg:h-[420px] aspect-[4/5] flex-shrink-0 overflow-hidden rounded-sm shadow-soft">
              {src && (<img src={src} alt={client.identity.businessName + " — project photo " + (i % imgs.length + 1)} className="h-full w-full object-cover" loading="lazy" />)}
              <div className="absolute inset-0 bg-gradient-to-t from-ink/30 via-transparent to-transparent" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- COMMERCIAL BLOCK -------------------------------- */
function CommercialBlock() {
  if (true /* No commercial role media or block copy binding in contract. */) return null;
  return (
    <section className="bg-ink text-bone py-24 lg:py-32">
      <div className="mx-auto max-w-[1500px] px-6 lg:px-10 grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 relative aspect-[16/10] overflow-hidden rounded-sm">
          {commercialImg && (<img src={commercialImg} alt="Commercial project" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />)}
          <div className="absolute inset-0 bg-gradient-to-tr from-ink/40 via-transparent to-transparent" />
        </div>
        <div className="lg:col-span-5">
          <div className="eyebrow !text-bone/55"><Sparkles className="inline h-3 w-3 mr-1 -mt-0.5 text-amber" />Builders & GCs</div>
          <h2 className="mt-4 font-display text-[40px] lg:text-[56px] leading-[1.02] text-bone">Commercial <span className="italic text-amber">projects.</span></h2>
          <p className="mt-5 text-bone/70 leading-relaxed"></p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/services" className="inline-flex items-center gap-2 px-5 py-3 rounded-sm bg-amber text-ink font-semibold">Our services</Link>
            <Link to="/contact" className="inline-flex items-center gap-2 px-5 py-3 rounded-sm border border-bone/20 text-bone hover:bg-bone/5">Talk to us</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- REVIEWS -------------------------------- */
function ReviewsBlock() {
  if (!client.trust.reviews.length) return null;
  const six = testimonials.slice(0, 3);
  return (
    <section className="py-24 lg:py-32 bg-background">
      <div className="mx-auto max-w-[1500px] px-6 lg:px-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12">
          <div>
            <div className="eyebrow">In customers' words</div>
            <h2 className="mt-3 font-display text-[40px] lg:text-[56px] text-ink leading-[1.02]">
              Real reviews. <span className="italic">Real names.</span>
            </h2>
          </div>
          <Link to="/reviews" className="inline-flex items-center gap-2 text-[14px] font-medium text-ink hover:text-amber">
            Read all reviews <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {six.map((t, i) => (
            <figure key={i} className="relative bg-card border border-border rounded-sm p-7 shadow-soft">
              <div className="font-display text-[44px] leading-none text-amber">“</div>
              <blockquote className="mt-2 text-[15.5px] leading-relaxed text-foreground/85">{t.quote}</blockquote>
              <figcaption className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <span className="font-display text-[16px] text-ink">{t.name}</span>
                <span className="eyebrow !text-[10px]"><a href={t.sourceUrl} target="_blank" rel="noreferrer">{t.platform}</a></span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- FAQ -------------------------------- */
function FAQBlock() {
  if (!client.content.faqs.length) return null;
  return (
    <section className="bg-secondary/60 py-24 lg:py-32">
      <div className="mx-auto max-w-[1100px] px-6 lg:px-10">
        <div className="text-center max-w-2xl mx-auto">
          <div className="eyebrow">Common questions</div>
          <h2 className="mt-3 font-display text-[36px] lg:text-[48px] text-ink leading-[1.05]">Answers, before you ask.</h2>
        </div>
        <dl className="mt-12 grid gap-px bg-border rounded-sm overflow-hidden border border-border">
          {FAQS.map((f, i) => (
            <div key={i} className="bg-card p-7 lg:p-8 grid lg:grid-cols-12 gap-6">
              <dt className="lg:col-span-5 font-display text-[20px] text-ink">{f.q}</dt>
              <dd className="lg:col-span-7 text-[15px] leading-relaxed text-foreground/80">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* -------------------------------- BIG CTA -------------------------------- */
function BigCTA() {
  return (
    <section className="relative overflow-hidden">
      {textureImg && (<img src={textureImg} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-90" loading="lazy" />)}
      <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/65 to-ink/30" />
      <div className="relative mx-auto max-w-[1400px] px-6 lg:px-10 py-24 lg:py-32">
        <div className="max-w-2xl">
          <div className="eyebrow !text-amber">Ready when you are</div>
          <h2 className="mt-4 font-display text-[44px] lg:text-[68px] leading-[1.02] text-bone">{client.content.ctaHeadline || "Let’s talk."}</h2>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href={`tel:${business.phoneRaw}`} className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-amber text-ink font-semibold text-[15px]">
              <Phone className="h-5 w-5" /> Call {business.phone}
            </a>
            <a href="/contact" className="inline-flex items-center gap-2 px-6 py-4 rounded-sm bg-bone text-ink font-medium text-[15px]">
              <MessageSquare className="h-5 w-5" /> Contact us
            </a>
            <Link to="/contact" className="inline-flex items-center gap-2 px-6 py-4 rounded-sm border border-bone/30 text-bone text-[15px]">
              Send a message
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
