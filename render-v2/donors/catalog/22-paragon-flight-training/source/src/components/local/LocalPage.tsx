import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Phone, MapPin, ChevronRight } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { StickyCallBar } from "@/components/StickyCallBar";
import { StickyDesktopCTA } from "@/components/StickyDesktopCTA";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
import { ControlButton } from "@/components/motion/ControlButton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CITIES, PROGRAMS, SITE, cityPath, programPath, HUB_PATH } from "@/data/local";

export interface LocalPageFAQ {
  q: string;
  a: string;
}

interface LocalPageProps {
  eyebrow: string;
  title: ReactNode;
  /** Plain-text title for ARIA / SEO mirrors */
  titleText: string;
  intro: string;
  paragraphs: string[];
  callout: { label: string; value: string }[]; // chips under hero
  bulletsTitle: string;
  bullets: string[];
  voiceQuestion: string;
  voiceAnswer: string;
  faqs: LocalPageFAQ[];
  /** "city" hides current city in cross-links; "program" hides current program. */
  crossLinkMode: "city" | "program";
  currentSlug: string;
}

export const LocalPage = ({
  eyebrow,
  title,
  titleText,
  intro,
  paragraphs,
  callout,
  bulletsTitle,
  bullets,
  voiceQuestion,
  voiceAnswer,
  faqs,
  crossLinkMode,
  currentSlug,
}: LocalPageProps) => {
  const otherCities = CITIES.filter((c) => c.slug !== currentSlug);
  const otherPrograms = PROGRAMS.filter((p) => p.slug !== currentSlug);

  return (
    <div className="min-h-screen bg-background">
      <ScrollProgress />
      <Nav />

      <main className="pt-24 md:pt-28">
        {/* Breadcrumb */}
        <div className="container-page">
          <nav aria-label="Breadcrumb" className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-2">
              <li><Link to="/" className="hover:text-primary">Home</Link></li>
              <li aria-hidden="true">/</li>
              <li><Link to={HUB_PATH} className="hover:text-primary">Service Areas</Link></li>
              <li aria-hidden="true">/</li>
              <li className="text-foreground">{titleText}</li>
            </ol>
          </nav>
        </div>

        {/* Hero */}
        <section className="container-page pt-10 md:pt-14">
          <span className="eyebrow">
            <span className="h-px w-8 bg-primary" /> {eyebrow}
          </span>
          <h1
            data-speakable
            className="display-xl mt-5 max-w-4xl text-4xl text-balance sm:text-5xl md:text-6xl"
          >
            {title}
          </h1>
          <p
            data-speakable
            className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            {intro}
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            {callout.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
              >
                <span className="text-primary">{c.label}</span>
                <span className="text-foreground">{c.value}</span>
              </span>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <ControlButton href="/#contact" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              Request Info
            </ControlButton>
            <ControlButton
              href={SITE.phoneTel}
              variant="secondary"
              icon={<Phone className="h-3.5 w-3.5" />}
              ariaLabel={`Call ${SITE.name} at ${SITE.phoneDisplay}`}
            >
              {SITE.phoneDisplay}
            </ControlButton>
          </div>
        </section>

        {/* Body copy */}
        <section className="container-page mt-20">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7 space-y-6">
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  data-speakable={i === 0 ? true : undefined}
                  className="text-base leading-relaxed text-muted-foreground md:text-[17px]"
                >
                  {p}
                </p>
              ))}
            </div>

            <aside className="lg:col-span-5">
              <div className="rounded-sm border border-border bg-surface p-6">
                <div className="hud-tag">{bulletsTitle}</div>
                <ul className="mt-4 space-y-3">
                  {bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-3 text-sm leading-relaxed text-foreground"
                    >
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </section>

        {/* Voice / generative answer block */}
        {voiceQuestion && voiceAnswer && <section className="bg-surface mt-24 py-20">
          <div className="container-page">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-4">
                <div className="hud-tag">Voice search</div>
                <p className="mt-3 font-display text-2xl text-foreground md:text-3xl">
                  "{voiceQuestion}"
                </p>
              </div>
              <p
                data-speakable
                className="lg:col-span-8 text-base leading-relaxed text-muted-foreground md:text-lg"
              >
                {voiceAnswer}
              </p>
            </div>
          </div>
        </section>

        }
        {/* FAQ */}
        {faqs.length > 0 && (
          <section className="container-page py-24">
            <span className="eyebrow">
              <span className="h-px w-8 bg-primary" /> FAQ
            </span>
            <h2 className="display-xl mt-4 text-3xl text-balance md:text-4xl">
              Common questions.
            </h2>
            <div className="mt-10 max-w-3xl">
              <Accordion type="single" collapsible>
                {faqs.map((f, i) => (
                  <AccordionItem
                    key={f.q}
                    value={`f-${i}`}
                    className="border-b border-border"
                  >
                    <AccordionTrigger className="py-5 text-left font-display text-base font-medium text-foreground hover:text-primary hover:no-underline md:text-lg">
                      <span className="flex items-baseline gap-4">
                        <span className="font-mono text-[11px] text-primary">0{i + 1}</span>
                        <span>{f.q}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pl-10 text-sm leading-relaxed text-muted-foreground">
                      {f.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </section>
        )}

        {/* Cross-links: every page links to every other landing page in the cluster */}
        <section className="bg-sky-deep border-t border-border py-20">
          <div className="container-page grid grid-cols-1 gap-12 lg:grid-cols-2">
            <div>
              <div className="hud-tag flex items-center gap-2">
                <MapPin className="h-3 w-3" /> Other service areas
              </div>
              <ul className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2">
                {otherCities.map((c) => (
                  <li key={c.slug}>
                    <Link
                      to={cityPath(c.slug)}
                      className="block bg-background p-4 transition-colors hover:bg-surface-elevated"
                    >
                      <div className="hud-tag">{c.minutes}</div>
                      <div className="mt-1 font-display text-sm text-foreground">{c.name}</div>
                    </Link>
                  </li>
                ))}
                {crossLinkMode === "city" && (
                  <li className="sm:col-span-2">
                    <Link
                      to={HUB_PATH}
                      className="block bg-surface-elevated p-4 transition-colors hover:bg-background"
                    >
                      <div className="hud-tag">Hub</div>
                      <div className="mt-1 font-display text-sm text-foreground">All service areas →</div>
                    </Link>
                  </li>
                )}
              </ul>
            </div>

            <div>
              <div className="hud-tag">Training programs</div>
              <ul className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2">
                {otherPrograms.map((p) => (
                  <li key={p.slug}>
                    <Link
                      to={programPath(p.slug)}
                      className="block bg-background p-4 transition-colors hover:bg-surface-elevated"
                    >
                      <div className="hud-tag">{p.shortName}</div>
                      <div className="mt-1 font-display text-sm text-foreground">{p.name}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <Footer />
      <StickyCallBar />
      <StickyDesktopCTA />
    </div>
  );
};
