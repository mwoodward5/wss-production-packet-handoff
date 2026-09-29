import { Link } from "@/wss/Link";
import type { ReactNode } from "react";
import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA } from "@/components/site/Sections";
import { LeadForm } from "@/components/site/LeadForm";
import { BreadcrumbSchema } from "@/components/site/Schema";
import { ServiceGallery, type ServiceShot } from "@/components/site/ServiceGallery";
import { CheckCircle2, ArrowRight, Phone } from "lucide-react";
import { CLIENT, absoluteUrl } from "@/config";

export interface ServicePageProps {
  slug: string;
  pageTitle: string;
  metaTitle: string;
  metaDescription: string;
  hero: { eyebrow: string; headline: ReactNode; sub: string };
  intro: ReactNode;
  scope: { title: string; items: string[] }[];
  process: { title: string; body: string }[];
  protectedTerms: string[];
  related: { to: string; label: string }[];
  defaultService: string;
  gallery?: ServiceShot[];
  longContent?: ReactNode;
}

export function ServicePageLayout({
  slug, pageTitle, hero, intro, scope, process, protectedTerms, related, defaultService, gallery, longContent,
}: ServicePageProps) {

  return (
    <SiteLayout>
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: pageTitle, url: absoluteUrl(`/${slug}`) },
      ]} />

      <section className="relative overflow-hidden border-b border-border bg-gradient-to-br from-foreground via-foreground to-foreground/90 text-background">
        <div className="absolute inset-0 grid-overlay opacity-[0.08] pointer-events-none" />
        <div aria-hidden className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full blur-3xl pointer-events-none animate-pulse" style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--primary) 55%, transparent), transparent 70%)" }} />
        <div aria-hidden className="absolute -bottom-40 -right-20 w-[32rem] h-[32rem] rounded-full blur-3xl pointer-events-none" style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--gold) 45%, transparent), transparent 70%)" }} />
        <div aria-hidden className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: "linear-gradient(115deg, transparent 40%, color-mix(in oklab, var(--primary) 25%, transparent) 50%, transparent 60%)", backgroundSize: "200% 100%", animation: "shimmer 6s linear infinite" }} />

        <div className="relative mx-auto max-w-7xl px-5 lg:px-8 pt-20 pb-16 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
          <div className="animate-fade-in">
            <nav className="text-xs text-background/60 mb-4">
              <Link to="/" className="hover:text-primary">Home</Link> <span className="px-2">/</span> <span className="text-background">{pageTitle}</span>
            </nav>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase bg-primary/15 text-primary ring-1 ring-primary/40 backdrop-blur">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> {hero.eyebrow}
            </span>
            <h1 className="mt-5 text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.02] tracking-tight font-display drop-shadow-[0_4px_24px_rgba(0,0,0,0.4)]">{hero.headline}</h1>
            <p className="mt-5 text-lg text-background/75 max-w-2xl leading-relaxed">{hero.sub}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/" hash="contact" className="btn-gold shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:-translate-y-0.5 transition-all">Contact us today to learn more <ArrowRight className="w-4 h-4" /></Link>
              <a href={`tel:${CLIENT.phoneE164}`} className="inline-flex items-center gap-2 px-5 py-3 rounded-lg ring-1 ring-background/30 text-background hover:bg-background/10 hover:ring-primary transition-all backdrop-blur"><Phone className="w-4 h-4" /> Call us</a>
            </div>
          </div>

          {gallery && gallery.length > 0 && (
            <div className="relative hidden lg:block animate-scale-in">
              <div aria-hidden className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-primary/40 via-gold/20 to-transparent blur-2xl" />
              <div className="relative grid grid-cols-2 gap-3 rotate-[1.5deg]">
                <div className="space-y-3 mt-8">
                  <div className="aspect-[3/4] rounded-2xl overflow-hidden ring-1 ring-primary/30 shadow-2xl shadow-black/40 hover:scale-105 transition-transform duration-500">
                    <img src={gallery[0].src} alt={gallery[0].alt} className="w-full h-full object-cover" loading="eager" />
                  </div>
                  {gallery[2] && (
                    <div className="aspect-square rounded-2xl overflow-hidden ring-1 ring-background/20 shadow-xl hover:scale-105 transition-transform duration-500">
                      <img src={gallery[2].src} alt={gallery[2].alt} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {gallery[1] && (
                    <div className="aspect-square rounded-2xl overflow-hidden ring-1 ring-background/20 shadow-xl hover:scale-105 transition-transform duration-500">
                      <img src={gallery[1].src} alt={gallery[1].alt} className="w-full h-full object-cover" loading="eager" />
                    </div>
                  )}
                  <div className="aspect-[3/4] rounded-2xl overflow-hidden ring-1 ring-gold/30 shadow-2xl shadow-black/40 hover:scale-105 transition-transform duration-500">
                    <img src={(gallery[3] ?? gallery[0]).src} alt={(gallery[3] ?? gallery[0]).alt} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                </div>
              </div>
              <div aria-hidden className="absolute -top-4 -right-4 w-20 h-20 border-t-2 border-r-2 border-primary rounded-tr-3xl" />
              <div aria-hidden className="absolute -bottom-4 -left-4 w-20 h-20 border-b-2 border-l-2 border-gold rounded-bl-3xl" />
            </div>
          )}
        </div>
      </section>

      {longContent && (
        <Section>
          <div className="prose-invert max-w-4xl mx-auto text-muted-foreground leading-relaxed space-y-6 [&_h2]:text-foreground [&_h2]:font-display [&_h2]:font-bold [&_h2]:text-3xl [&_h2]:md:text-4xl [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:text-foreground [&_h3]:font-bold [&_h3]:text-xl [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:text-base [&_p]:md:text-lg">
            {longContent}
          </div>
        </Section>
      )}

      <Section className={longContent ? "!pt-0" : undefined}>
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-12">
          <article className="prose-invert max-w-none">
            <div className="text-lg text-muted-foreground leading-relaxed space-y-5">{intro}</div>
          </article>
          <aside className="premium-card p-6 h-fit lg:sticky lg:top-28">
            <span className="chip">Get In Touch</span>
            <h3 className="mt-4 text-2xl font-bold font-display">Request a Quote</h3>
            <p className="mt-1 text-sm text-muted-foreground mb-4">Contact us directly to discuss your project.</p>
            <LeadForm topic={`${pageTitle} inquiry`} defaultService={defaultService} cta="Request a callback" />
          </aside>
        </div>
      </Section>


      {scope.length > 0 && <Section className="!pt-0">
        <SectionHeader eyebrow="Scope" title={<>What's included in <span className="text-primary">{pageTitle.toLowerCase()}</span></>} />
        <div className="mt-10 grid md:grid-cols-2 gap-5">
          {scope.map((s) => (
            <div key={s.title} className="premium-card p-6">
              <h3 className="font-bold">{s.title}</h3>
              <ul className="mt-3 space-y-2">
                {s.items.map((it) => (
                  <li key={it} className="flex gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" /> <span className="capitalize">{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>}

      {process.length > 0 && <Section className="!pt-0">
        <SectionHeader center eyebrow="Process" title={<>How we <span className="text-primary">work</span></>} />
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {process.map((p, i) => (
            <div key={p.title} className="premium-card p-6">
              <div className="text-primary text-sm font-bold tracking-widest">STEP {i + 1}</div>
              <h3 className="mt-2 font-bold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>}

      {gallery && gallery.length > 0 && (
        <Section className="!pt-0">
          <SectionHeader eyebrow="Recent Work" title={<>Real <span className="text-primary">{pageTitle.toLowerCase()}</span> projects</>} intro="Tap any image to enlarge." />
          <div className="mt-10"><ServiceGallery shots={gallery} /></div>
        </Section>
      )}

      <Section className="!pt-0">
        <CallCTA heading={`Plan your ${pageTitle.toLowerCase()} project with ${CLIENT.businessName}`} sub={`${CLIENT.serviceAreaLabel ? `Serving ${CLIENT.serviceAreaLabel}. ` : ""}Call ${CLIENT.phone} to discuss your project.`} />
      </Section>

      {related.length > 0 && <Section className="!pt-0">
        <SectionHeader eyebrow="Related" title={<>Other services we <span className="text-primary">handle</span></>} />
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
          {related.map((r) => (
            <Link key={r.to} to={r.to} className="premium-card p-6 group flex items-center justify-between w-full">
              <div className="font-semibold">{r.label}</div>
              <div className="text-sm text-primary inline-flex items-center gap-1">Learn more <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-1" /></div>
            </Link>
          ))}
        </div>

        <div className="mt-10 text-sm text-muted-foreground">
          Our services:{" "}
          <span className="text-foreground">{protectedTerms.join(" · ")}</span>
        </div>
      </Section>}
    </SiteLayout>
  );
}

