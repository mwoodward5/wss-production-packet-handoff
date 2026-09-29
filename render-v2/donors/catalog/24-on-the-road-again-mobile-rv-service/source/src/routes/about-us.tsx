import { WSS, pageCopy } from '@/wss/bridge';

import { SiteLayout } from "@/components/site/Layout";
import { Section, SectionHeader, CallCTA } from "@/components/site/Sections";
import { BreadcrumbSchema, LocalBusinessSchema } from "@/components/site/Schema";
import { CLIENT, TRUST, absoluteUrl } from "@/config";
import { MEDIA } from "@/config/media";
import { ShieldCheck, Users, Wrench, Heart, Award } from "lucide-react";

export function AboutPage() {
  return (
    <SiteLayout>
      <LocalBusinessSchema />
      <BreadcrumbSchema items={[
        { name: "Home", url: absoluteUrl("/") },
        { name: "About Us", url: absoluteUrl("/about-us") },
      ]} />

      <Section className="!pb-8">
        <div className="grid lg:grid-cols-[1fr_1fr] gap-10 items-center">
          <div className="max-w-3xl">
            <span className="chip mb-5">About Us</span>
            <h1 className="font-serif text-3xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
              {WSS.content.whyHeadline || CLIENT.businessName}
            </h1>
            <p className="mt-5 text-lg text-muted-foreground leading-relaxed">
              {pageCopy("about",WSS.content.about)}
            </p>
          </div>
          {MEDIA.aboutPortrait && <div className="relative aspect-[4/3] rounded-3xl overflow-hidden border border-border bg-muted">
            <img src={MEDIA.aboutPortrait} alt={`${CLIENT.businessName} team`} className="w-full h-full object-cover" />
          </div>}
        </div>
      </Section>

      {WSS.content.values.length > 0 && <Section className="!pt-0"><div className="grid lg:grid-cols-3 gap-6">{WSS.content.values.slice(0,3).map(v=><article key={v.title} className="rounded-2xl border border-border bg-card p-7"><Heart className="w-6 h-6 text-primary mb-4"/><h2 className="font-serif text-xl font-semibold">{v.title}</h2><p className="mt-3 text-muted-foreground leading-relaxed text-sm">{v.body}</p></article>)}</div></Section>}
      {WSS.trust.badges.length > 0 &&       <section className="border-y border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-14">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div>
              <span className="chip mb-4">Credentials</span>
              <h2 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
                <span className="text-primary">Credentials</span>.
              </h2>
            </div>
            <ul className="grid sm:grid-cols-2 gap-3 text-sm">
              {WSS.trust.badges.map(b=>({mark:b.label,title:b.label,sub:b.sublabel})).map((b) => (
                <li
                  key={b.mark}
                  className="group relative flex items-center gap-4 rounded-2xl border border-border/80 bg-gradient-to-br from-card to-muted/40 p-4 shadow-sm transition hover:shadow-md hover:border-primary/40 min-w-0"
                >
                  <span className="relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground ring-2 ring-primary/20 shadow-[var(--shadow-gold)]">
                    <span className="font-serif text-[0.7rem] font-bold tracking-tight leading-none text-center px-1">
                      {b.mark}
                    </span>
                    <span className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold text-primary-foreground ring-2 ring-card">
                      <ShieldCheck className="w-3 h-3" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground leading-snug">{b.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground leading-snug">{b.sub}</div>
                  </div>
                </li>
              ))}
            </ul>

          </div>

        </div>
      </section>}

      {WSS.content.values.length > 3 && <Section><div className="grid md:grid-cols-2 gap-8">{WSS.content.values.slice(3).map(v=><div key={v.title} className="rounded-2xl border border-border bg-card p-7"><h3 className="font-serif text-xl font-semibold">{v.title}</h3><p className="mt-3 text-muted-foreground leading-relaxed text-sm">{v.body}</p></div>)}</div></Section>}
      <Section className="!pb-10">
        <CallCTA heading={WSS.content.ctaHeadline || "Contact us"} sub={WSS.content.ctaBody} secondaryHref="/contact" secondaryLabel="Contact" />
      </Section>
    </SiteLayout>
  );
}
