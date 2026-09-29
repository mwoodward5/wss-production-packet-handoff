import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Heart, Users, Award, ArrowRight } from "lucide-react";
import heroImg from "@/assets/hero-concrete.webp";
import { CallButton } from "@/components/CallButton";
import { SectionHeading } from "@/components/SectionHeading";
import { TrustChips } from "@/components/TrustChips";
import { breadcrumbLd, jsonLd } from "@/lib/schema";
import { useLiveAbout, useLiveIdentity } from "@/lib/wssc";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About {{BUSINESS_NAME}} — Concrete & General Contracting in {{CITY}}, {{STATE}}" },
      {
        name: "description",
        content:
          "Concrete and general contracting in {{CITY}}, {{STATE}} — foundations, flatwork, demolition, renovation. Written, itemized quotes.",
      },
      { property: "og:title", content: "About {{BUSINESS_NAME}} — {{CITY}}, {{STATE}}" },
      { property: "og:description", content: "Concrete and general contracting in {{CITY}}, {{STATE}}." },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
    links: [{ rel: "canonical", href: "{{SITE_URL}}/about" }],
    scripts: [jsonLd(breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "About", path: "/about" },
    ]))],
  }),
  component: AboutPage,
});

function AboutPage() {
  const id = useLiveIdentity();
  const liveAbout = useLiveAbout();

  return (
    <>
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div className="absolute inset-0 opacity-40">
          <img src={heroImg} alt="Commercial concrete project" className="h-full w-full object-cover" loading="eager" />
          <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/80 to-primary/40" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-tight md:text-6xl">
            Based in {"{{CITY}}"}. <span className="text-gold">Built on the work.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-primary-foreground/85">
            {"{{BUSINESS_NAME}}"} is a concrete and general contracting company: the phone gets answered, the scope
            gets written down, and the work gets finished.
          </p>
          <div className="mt-7"><TrustChips tone="dark" /></div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 lg:px-6">
        <SectionHeading eyebrow="Our Story" title="A different kind of contractor." />
        <div className="prose-content mt-8 space-y-5 text-lg leading-relaxed text-muted-foreground">
          {liveAbout ? (
            <p>{liveAbout}</p>
          ) : (
            <>
              <p>
                {"{{BUSINESS_NAME}}"} was founded on one belief: clients deserve a contractor who picks up the
                phone, gives a straight answer, and finishes what they start. That is the bar on every single
                day.
              </p>
              <p>
                We are headquartered in <strong className="text-foreground">{"{{CITY}}"}, {"{{STATE}}"}</strong>.
                The work spans commercial concrete — foundations, flatwork, demolition, excavation, ADA ramps,
                parking-lot pads — plus residential driveways, patios, and general contracting projects.
              </p>
              <p>
                What makes the approach different is simple: itemized written quotes, a spec you can hold the
                work to, and one point of contact from the first call through the final walkthrough.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-12 lg:px-6">
        <SectionHeading eyebrow="What we do" title="Concrete is the craft." />
        <div className="prose-content mt-6 space-y-5 text-lg leading-relaxed text-muted-foreground">
          <p>
            Most of the work is poured concrete: warehouse pads, tilt-up footings, ADA ramp retrofits,
            parking-lot pours, loading-dock slabs, and equipment pads — plus the residential side of driveways,
            patios, and pool decks. If the project is poured concrete, it can probably be quoted.
          </p>
          <p>
            The related trades ship under one roof too:{" "}
            <Link to="/foundations-excavation" className="font-semibold text-foreground underline-offset-4 hover:underline">foundations and excavation</Link>,{" "}
            <Link to="/flatwork-driveways" className="font-semibold text-foreground underline-offset-4 hover:underline">driveways and flatwork</Link>, and{" "}
            <Link to="/concrete-demolition" className="font-semibold text-foreground underline-offset-4 hover:underline">concrete demolition with haul-off</Link>.
            Handling them together removes scheduling gaps and finger-pointing between trades — and allows
            demo-and-repour in a single mobilization where the scope allows.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-12 lg:px-6">
        <SectionHeading eyebrow="How we work" title="Built around three commitments." />
        <div className="prose-content mt-6 space-y-5 text-lg leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">One point of contact.</strong> Quality control, scheduling, and
            accountability stay with the name on the contract — a single number to call when something needs
            attention.
          </p>
          <p>
            <strong className="text-foreground">Itemized written quotes.</strong> Every quote spells out concrete
            strength (PSI), slab thickness, reinforcement grade and spacing, sub-base prep, finish, control-joint
            plan, and haul-off. Comparing bids should mean comparing scopes, not price tags.
          </p>
          <p>
            <strong className="text-foreground">The walkthrough at the end.</strong> The work gets walked with
            you when it's done, and the same number that answered before the pour answers after it.
          </p>
        </div>
      </section>

      <section className="bg-secondary py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeading eyebrow="What we stand for" title="Four values that guide every job." align="center" />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: ShieldCheck, t: "Spec first", b: "The right mix, thickness, and reinforcement — written down before the pour." },
              { icon: Heart, t: "Community work", b: "Projects for the people and businesses up the road, not across the country." },
              { icon: Users, t: "Direct crews", b: "The crew that quotes the work is accountable for the work." },
              { icon: Award, t: "In writing", b: "Scope, schedule, and price — itemized in the quote, not improvised on site." },
            ].map((v) => (
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

      <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
        <div className="grid gap-10 rounded-3xl border border-border bg-card p-8 shadow-elegant md:p-12 lg:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="font-display text-3xl font-semibold md:text-4xl">Ready to talk about your project?</h2>
            <p className="mt-3 text-muted-foreground">
              Send a message or call — either way the next step is a written response.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <CallButton variant="gold" location="about-bottom" />
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold">
                All contact options <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            {id.phone && (
              <div className="rounded-xl bg-secondary p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Phone</div>
                <div className="font-display text-lg font-semibold">{id.phone}</div>
              </div>
            )}
            {id.email && (
              <div className="rounded-xl bg-secondary p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Email</div>
                <div className="break-all font-semibold">{id.email}</div>
              </div>
            )}
            <div className="rounded-xl bg-secondary p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Based in</div>
              <div className="font-semibold">{"{{CITY}}"}, {"{{STATE}}"}</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
