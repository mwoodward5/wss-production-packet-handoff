import {RichCopy} from "@/components/RichCopy";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Heart, Users, Award, ArrowRight } from "lucide-react";
import { CallButton } from "@/components/CallButton";
import { SectionHeading } from "@/components/SectionHeading";
import { TrustChips } from "@/components/TrustChips";
import { site, client, services, richCopy, aboutImage } from "@/lib/site";
import { breadcrumbSchema, jsonLd } from "@/lib/schema";

export const Route=createFileRoute('/about')({head:()=>({meta:[{title:site.name + ' — About'}]}),component:AboutPage});

export function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          {aboutImage && <img src={aboutImage} alt={site.name} className="h-full w-full object-cover" loading="eager" />}
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/80 to-primary/40" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-6xl">
            About <span className="text-gold">{site.name}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            {site.city}, {site.state}
          </p>
          <div className="mt-7"><TrustChips tone="dark" /></div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6">
        <SectionHeading eyebrow="Our Story" title={site.name} />
        <div className="prose-content mt-8 space-y-5 text-lg leading-relaxed text-muted-foreground"><RichCopy text={richCopy('about') || client.content.about}/></div>
      </section>
      <section className="mx-auto max-w-4xl px-4 pb-12 lg:px-6">
        <SectionHeading eyebrow="What we do" title="Our services"/>
        <div className="prose-content mt-6 space-y-5 text-lg leading-relaxed text-muted-foreground">{services.map(s=><p key={s.slug}><Link to={s.href} className="font-semibold text-foreground underline">{s.title}</Link> — {s.short}</p>)}</div>
      </section>

      {client.content.values.length > 0 && <section className="bg-secondary py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeading eyebrow="What we stand for" title="Our values" align="center" />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {client.content.values.map(v=>({icon:Award,t:v.title,b:v.body})).map((v) => (
              <div key={v.t} className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-gold text-gold-foreground">
                  <v.icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-lg font-semibold">{v.t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{v.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      }
      <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <div className="grid gap-10 rounded-3xl border border-border bg-card p-8 shadow-elegant md:p-12 lg:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="font-display text-3xl font-semibold md:text-4xl">Ready to talk about your project?</h2>
            <p className="mt-3 text-muted-foreground">
              {client.content.ctaBody}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <CallButton variant="gold" location="about-bottom" label={`Call ${site.phone}`} />
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold">
                Get a quote <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-secondary p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Phone</div>
              <div className="font-display text-lg font-semibold">{site.phone}</div>
            </div>
            {site.email && <div className="rounded-xl bg-secondary p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Email</div>
              <div className="break-all font-semibold">{site.email}</div>
            </div>}
            {site.hours && <div className="rounded-xl bg-secondary p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Hours</div>
              <div className="font-semibold">{site.hours}</div>
            </div>}
          </div>
        </div>
      </section>
    </>
  );
}
