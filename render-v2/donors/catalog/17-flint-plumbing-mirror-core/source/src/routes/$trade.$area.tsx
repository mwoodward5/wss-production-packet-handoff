/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: the generated near-me landing page, one per city in
 * │ trustConfig.location.serviceAreas[] (Service + Speakable + rating JSON-LD,
 * │ per-area map, reviewer faces, CTAs).
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client, every trade.
 * │ ROUTE SHAPE: /{clientConfig.vertical.nearMeSlug}/{city-slug}
 * │   e.g. /plumber/buda, /roofer/kyle, /dentist/austin. Any other first
 * │   segment 404s; anything listed in clientConfig.vertical.aliases[] is
 * │   permanently redirected to the canonical slug.
 * │ WHAT THE ENGINE FEEDS IT:
 * │   clientConfig.vertical.nearMeSlug|nearMeNoun <- engine choice per trade
 * │   trustConfig.location.serviceAreas[]         <- Firecrawl service-area scrape
 * │   trustConfig.location.primary.region         <- Places addressComponents
 * │   trustConfig.voice.answers[]                 <- engine-written, 1-2 factual sentences
 * │ FULL SPEC: MIRROR-PACK/02-FIELD-MAP.md §near-me pages
 * └──────────────────────────────────────────────────────────────────────────
 */
import { clientData } from "@/wss-bridge";

import { clientConfig } from "@/client.config";
import { LocalMap } from "@/components/LocalMap";
import { BrandMark } from "@/components/CinematicHero";
import { areaSlug, findArea, nearMePath } from "@/lib/areas";
import { trustConfig } from "@/trust.config";
import { TrustProvider } from "@/trust-widgets/TrustProvider";
import { StarSummaryBar } from "@/trust-widgets/components/StarSummaryBar";
import { ReviewWall } from "@/trust-widgets/components/ReviewWall";
import { ServiceMenuGrid } from "@/trust-widgets/components/ServiceMenuGrid";
import { EmergencyCTABand } from "@/trust-widgets/components/EmergencyCTABand";
import { VoiceAnswerBlock } from "@/trust-widgets/components/VoiceAnswerBlock";
import { JsonLd } from "@/trust-widgets/components/primitives";

const REGION = trustConfig.location.primary?.region ?? "";
const REGION_SUFFIX = REGION ? `, ${REGION}` : "";

export function AreaPage({ area }: { area: string }) {
  const cfg = trustConfig;
  const noun = clientConfig.vertical.nearMeNoun;
  const rating = cfg.proof.ratings?.[0];

  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: cfg.business.category,
    areaServed: { "@type": "City", name: area },
    provider: {
      "@type": cfg.business.schemaType,
      name: cfg.business.name,
      telephone: cfg.contact.phone,
      url: clientConfig.canonicalUrl,
      ...(cfg.location.primary?.geo
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: cfg.location.primary.geo.lat,
              longitude: cfg.location.primary.geo.lng,
            },
          }
        : {}),
      ...(rating
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: rating.ratingValue,
              reviewCount: rating.reviewCount,
            },
          }
        : {}),
    },
  };

  return (
    <TrustProvider config={cfg} className="min-h-screen bg-background text-foreground">
      <JsonLd data={schema} />

      <header className="px-5 py-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4">
          <BrandMark />
          <a
            href={`tel:${cfg.contact.phone}`}
            className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
          >
            {cfg.contact.phoneDisplay}
          </a>
        </div>
      </header>

      <section className="reveal-on-scroll px-5 pb-16 sm:px-8">
        <div className="mx-auto w-full max-w-[1180px]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.32em] text-mint">
            Near me · {area}
            {REGION_SUFFIX}
          </p>
          <h1 className="max-w-4xl font-[Archivo] text-[clamp(2.2rem,5.5vw,4rem)] font-extrabold leading-[0.98] tracking-tight text-cream">
            Looking for a {noun.toLowerCase()} in{" "}
            <em className="text-shimmer font-[Instrument_Serif] not-italic">{area}</em>?
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {cfg.business.name} — {area}. {clientData.content.serviceIntro}
          </p>
          <div className="mt-8">
            <StarSummaryBar compact />
          </div>
        </div>
      </section>

      <section className="reveal-on-scroll bg-[color-mix(in_oklab,var(--cream)_5%,transparent)] px-5 py-16 sm:px-8">
        <div className="mx-auto w-full max-w-[1180px]">
          <h2 className="mb-8 font-[Archivo] text-3xl font-extrabold text-cream">
            {cfg.labels.serviceMenuTitle} in {area}
          </h2>
          <ServiceMenuGrid />
        </div>
      </section>

      <section className="reveal-on-scroll px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-[1180px] gap-10">
          <LocalMap />
          <VoiceAnswerBlock />
        </div>
      </section>

      {Boolean(cfg.proof.reviews?.length) && (<section className="reveal-on-scroll bg-[color-mix(in_oklab,var(--cream)_5%,transparent)] px-5 py-16 sm:px-8">
        <div className="mx-auto w-full max-w-[1180px]">
          <h2 className="mb-8 font-[Archivo] text-3xl font-extrabold text-cream">
            What neighbours say
          </h2>
          <ReviewWall initialCount={6} />
        </div>
      </section>)}

      <section className="px-5 py-16 sm:px-8">
        <div className="mx-auto w-full max-w-[1180px]">
          <EmergencyCTABand />
          <nav className="mt-12 flex flex-wrap gap-2" aria-label="Other service areas">
            {(cfg.location.serviceAreas ?? [])
              .filter((a) => a !== area)
              .map((a) => (
                <a
                  key={a}
                  href={nearMePath(areaSlug(a))}
                  className="rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-mint hover:text-cream"
                >
                  {noun} in {a}
                </a>
              ))}
          </nav>
        </div>
      </section>
    </TrustProvider>
  );
}
