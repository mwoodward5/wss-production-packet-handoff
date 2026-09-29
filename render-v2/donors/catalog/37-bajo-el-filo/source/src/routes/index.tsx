import {getClient,pageMeta} from '@/wss/bridge';
import {HeroMedia} from '@/wss/HeroMedia';
const client=getClient();
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { heroMontage } from "@/data/media";
import { copy } from "@/data/copy";
import { ArtAtlas } from "@/components/ArtAtlas";
import { ChapterMark, Epigraph } from "@/components/ChapterMark";
import { InkWashReveal } from "@/components/InkWashReveal";
import { ThreeDoors } from "@/components/home/ThreeDoors";
import { TheTeacher } from "@/components/home/TheTeacher";
import { ThePlace } from "@/components/home/ThePlace";
import { BrandMark } from "@/components/brand/BrandMark";

export const Route = createFileRoute("/")({
  head: () => pageMeta(client.identity.businessName),
  component: Home,
});

function Home() {
  return (
    <>
      <Hero />
      <PromiseStrip />
      <ThreeDoors />
      <TheTeacher />
      <ThePlace />

      <ArtAtlas />



      {client.content.faqs.length>0 && <FAQBlock />}
      <ClosingBand />
    </>
  );
}

/* ---------------- EPIGRAPH INTERSTITIAL ---------------- */
/* ---------------- HERO ---------------- */
function Hero() {
  return (
    <section className="relative isolate min-h-dvh overflow-hidden bg-ink pt-24 md:pt-32">
      <div className="absolute inset-0 -z-10">
        <HeroMedia />
        {/* softer gradient — lets the footage breathe */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ink)_10%,transparent)_0%,color-mix(in_oklab,var(--ink)_35%,transparent)_45%,var(--ink)_100%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_35%,transparent_0%,color-mix(in_oklab,var(--ink)_55%,transparent)_60%)]"
        />
      </div>

      <div className="mx-auto grid min-h-[calc(100dvh-6rem)] max-w-[1440px] grid-cols-12 gap-6 px-6 pb-16 pt-6 md:px-10 md:pb-24">
        {/* Vertical CJK caption */}
        <div aria-hidden className="pointer-events-none absolute right-6 top-32 hidden md:block">
          <div className="vwrite font-serif text-3xl italic text-edge/60 tracking-widest">
            {copy.hero.vertical}
          </div>
        </div>

        <div className="col-span-12 flex items-end md:col-span-8">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <ChapterMark n="I" variant="seal" />
              <span className="h-px w-16 bg-edge/70" />
              <span className="eyebrow text-edge">{copy.hero.eyebrow}</span>
            </div>
            <InkWashReveal>
              <h1 className="mt-6 font-serif text-[clamp(2.4rem,6.4vw,6rem)] font-light leading-[0.98] tracking-[-0.03em] text-bone">
                {copy.hero.title}
              </h1>
            </InkWashReveal>
            <p className="anim-fade-up mt-8 max-w-xl text-lg leading-relaxed text-bone-dim md:text-xl">
              {copy.hero.sub}
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                to="/training"
                className="eyebrow inline-flex items-center gap-3 rounded-full bg-bone px-6 py-4 text-ink transition-transform hover:-translate-y-0.5"
              >
                Explore training <span aria-hidden>→</span>
              </Link>
              <Link
                to="/contact"
                className="eyebrow inline-flex items-center gap-3 border-b border-edge pb-2 text-bone hover:text-edge"
              >
                Contact
              </Link>
            </div>
            <div className="mt-10 max-w-md">
              <Epigraph text={copy.hero.epigraph.text} credit={copy.hero.epigraph.credit} />
            </div>
          </div>
        </div>
        {client.content.seasonalNote && <div className="col-span-12 hidden items-end justify-end md:col-span-4 md:flex"><div className="glass w-full max-w-xs p-5"><div className="eyebrow text-edge">Updates</div><div className="mt-2 font-serif text-2xl text-bone">{client.content.seasonalNote}</div><Link to="/contact" className="eyebrow mt-6 inline-flex text-edge">Inquire →</Link></div></div>}
      </div>

      <div aria-hidden className="absolute bottom-0 left-0 right-0 h-24 bg-paper clip-blade" />
    </section>
  );
}

/* ---------------- PROMISE ---------------- */
function PromiseStrip() {
  const disciplines=client.services.map(s=>s.shortLabel);
  return (
    <section className="on-paper border-b border-hairline py-14">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
          <p
            className="max-w-2xl font-serif text-2xl leading-snug tracking-tight md:text-3xl"
            style={{ color: "var(--paper-ink)" }}
          >
            {client.content.serviceIntro}
          </p>
          <div className="flex items-center gap-3">
            <span className="h-px w-16 bg-edge" />
            <span className="eyebrow">{client.identity.businessName}</span>
          </div>
        </div>
        {/* Discipline row — anchors the four traditions */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-hairline pt-6">
          {disciplines.map((d, i) => (
            <span key={d} className="flex items-center gap-8">
              <span className="eyebrow text-[10px]" style={{ color: "var(--paper-ink)" }}>
                {d}
              </span>
              {i < disciplines.length - 1 && (
                <span
                  aria-hidden
                  className="hidden h-1 w-1 rotate-45 md:block"
                  style={{ background: "var(--edge)" }}
                />
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}


/* ThreeOffers and PhoneRail were replaced by ThreeDoors + TheVertical. */



/* ---------------- SEMINARS WORLDWIDE ---------------- */
/* ---------------- FAQ ---------------- */
function FAQBlock() {
  return (
    <section id="faq" aria-labelledby="faq-h" className="on-paper border-y border-hairline py-24 md:py-32">
      <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-6 px-6 md:px-10">
        <div className="col-span-12 md:col-span-4">
          <div className="flex items-center gap-3">
            <ChapterMark n="VIII" variant="seal" onLight />
            <span className="eyebrow">Questions</span>
          </div>
          <h2 id="faq-h" className="mt-4 font-serif text-4xl leading-[1.02] tracking-[-0.02em] md:text-6xl" style={{ color: "var(--paper-ink)" }}>
            Before you <span className="italic" style={{ color: "var(--paper-steel)" }}>reach out.</span>
          </h2>
          <div className="mt-10">
            <Epigraph text={copy.faqEpigraph.text} credit={copy.faqEpigraph.credit} />
          </div>
        </div>
        <div className="col-span-12 md:col-span-8">
          <div className="border-t border-hairline">
            {copy.faqs.map(([q, a]) => (
              <details key={q} className="group border-b border-hairline py-6">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                  <span className="flex items-start gap-4">
                    <span className="mt-1 hidden opacity-0 transition-opacity group-open:opacity-70 md:inline-block">
                      <BrandMark onLight size={18} withSeal={false} style={{ color: "var(--seal)" }} />
                    </span>
                    <span className="font-serif text-xl md:text-2xl" style={{ color: "var(--paper-ink)" }}>{q}</span>
                  </span>
                  <span className="numeral shrink-0 text-xl transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-4 max-w-2xl md:pl-9" style={{ color: "var(--paper-steel)" }}>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- CLOSING BAND ---------------- */
function ClosingBand() {
  return (
    <section className="relative overflow-hidden bg-ink py-28 md:py-40">
      <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-paper clip-blade-b" />
      <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-6 px-6 pt-16 md:px-10">
        <div className="col-span-12 md:col-span-8">
          <div className="flex items-center gap-3">
            <ChapterMark n="IX" variant="seal" />
            <span className="eyebrow text-edge">Begin</span>
          </div>
          <h2 className="mt-4 font-serif text-5xl leading-[0.98] tracking-[-0.025em] text-bone md:text-8xl">
            {copy.closing.title}
            <span className="block italic text-bone-dim">{copy.closing.sub}</span>
          </h2>
        </div>
        <div className="col-span-12 flex items-end md:col-span-4">
          <Link
            to="/contact"
            className="eyebrow group inline-flex w-full items-center justify-center gap-3 rounded-full bg-bone px-6 py-5 text-ink transition-transform hover:-translate-y-0.5 md:w-auto"
          >
            <BrandMark
              size={22}
              withSeal={false}
              className="transition-transform group-hover:rotate-90"
              style={{ color: "var(--seal)" }}
            />
            <span>Send an inquiry</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
