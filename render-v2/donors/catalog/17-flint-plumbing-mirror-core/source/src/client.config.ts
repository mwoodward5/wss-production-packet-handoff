import { clientData } from "./wss-bridge";
export type HeroMode = "video" | "kenburns";

export interface HeroStill {
  /** absolute path under /public, or a full CDN url */
  src: string;
  alt: string;
  /** ken-burns start/end scale + origin, so each still moves differently */
  from?: string;
  to?: string;
  origin?: string;
}

export interface ClientConfig {
  /** stable slug used for storage keys, cache keys and the mirror manifest */
  siteKey: string;
  /** canonical https origin of the deployed mirror, no trailing slash */
  canonicalUrl: string;
  /**
   * MIRROR:PLACEHOLDER — vertical + near-me route shape. This is what makes the
   * template universal: the near-me pages live at /{nearMeSlug}/{city} and every
   * headline noun comes from `nearMeNoun`. No route file is renamed per client.
   *   key         <- engine choice, must exist in src/trust-widgets/verticals
   *   nearMeSlug  <- slugified trade word people search ("plumber", "roofer")
   *   nearMeNoun  <- capitalised singular used in H1s and <title>
   *   aliases     <- old slugs to 301 to nearMeSlug (keeps inbound links alive)
   */
  vertical: {
    key: string;
    nearMeSlug: string;
    nearMeNoun: string;
    aliases?: string[];
  };

  brand: {
    /** short display wordmark in the header */
    wordmark: string;
    /** optional second line under the wordmark */
    wordmarkSub?: string;
    logoSrc?: string;
    logoAlt?: string;
    /**
     * Multiplier on the header/footer logo size. 1 = the 34px baseline.
     * Bump this per client when the mark is delicate; 2 is the current build.
     */
    logoScale?: number;

    /** Google Fonts families — injected as a <link> from __root.tsx */
    fonts: { display: string; serif: string; body: string };
    /** oklch strings; written straight into :root by MirrorTheme */
    palette: {
      background: string;
      cream: string;
      petrolDeep: string;
      coral: string;
      mint: string;
    };
  };
  hero: {
    mode: HeroMode;
    /** used when mode === "video"; muted/looping/inline background reel */
    videoSrc?: string;
    videoPoster?: string;
    /** used when mode === "kenburns", and as the video fallback */
    stills: HeroStill[];
    /** seconds each still holds before the crossfade */
    stillDurationSec?: number;
    kicker: string;
    headline: string;
    headlineAccent: string;
    sub?: string;
  };
  maps: {
    /** Google Place ID — powers live review refresh + the review-request link */
    placeId?: string;
    /** direct "write a review" url; derived from placeId when omitted */
    writeReviewUrl?: string;
    /** static/embed map style */
    zoom?: number;
  };
  reviewRequest: {
    heading: string;
    blurb: string;
    /** selectable phrases the customer can assemble into a draft review */
    prompts: { id: string; label: string; text: string }[];
    closers: string[];
  };
  /** where the mirroring engine pulled this client from; surfaced in /llms.txt */
  provenance: {
    donorUrl?: string;
    clientSiteUrl?: string;
    scrapedAt?: string;
  };
}

export const clientConfig: ClientConfig = {
  siteKey: clientData.source.prospectId,
  canonicalUrl: clientData.identity.website.replace(/\/$/, ''),
  vertical: { key: 'plumbing', nearMeSlug: 'plumber', nearMeNoun: 'Plumber', aliases: [] },
  brand: {
    wordmark: clientData.identity.businessName,
    wordmarkSub: `${clientData.identity.city}, ${clientData.identity.state}`,
    logoSrc: clientData.identity.logoOnDark, logoAlt: `${clientData.identity.businessName} logo`, logoScale: 2,
    fonts: { display: 'Archivo:wght@600;700;800', serif: 'Instrument+Serif:ital@0;1', body: 'Inter+Tight:ital,wght@0,400;0,500;0,600;1,400' },
    palette: { background: 'oklch(0.253 0.045 195.5)', cream: 'oklch(0.949 0.017 84.6)', petrolDeep: 'oklch(0.205 0.042 196.4)', coral: 'oklch(0.702 0.163 32.5)', mint: 'oklch(0.858 0.121 173.4)' },
  },
  hero: {
    mode: clientData.hero.video ? 'video' : 'kenburns', videoSrc: clientData.hero.video || undefined,
    videoPoster: clientData.hero.poster, stillDurationSec: 7,
    stills: [{ src: clientData.hero.poster, alt: '' }, ...clientData.media.filter(m => m.role === 'hero' && m.path !== clientData.hero.poster).slice(0,2).map(m => ({src: m.path, alt: ''}))],
    kicker: clientData.hero.eyebrow, headline: clientData.hero.line1, headlineAccent: clientData.hero.emphasis, sub: clientData.hero.line3,
  },
  maps: {}, reviewRequest: { heading: '', blurb: '', prompts: [], closers: [] },
  provenance: { clientSiteUrl: clientData.identity.website, scrapedAt: clientData.source.compiledAt },
};
export function writeReviewUrl(cfg: ClientConfig = clientConfig): string | undefined { return cfg.maps.writeReviewUrl; }
export function fontHref(cfg: ClientConfig = clientConfig): string {
  const f = cfg.brand.fonts;
  return `https://fonts.googleapis.com/css2?family=${f.display}&family=${f.body}&family=${f.serif}&display=swap`;
}
