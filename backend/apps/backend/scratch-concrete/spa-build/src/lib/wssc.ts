// THE WSS CONTENT BRIDGE — window.__WSS_CONTENT__ -> the design's own JSX.
//
// The engine injects a data island (#wss-content) BEFORE this bundle boots
// (lib/mirror-engine/content-inject.js). A donor that declares
// `consumes_content` renders the verified arrays ITSELF — that is a real
// content slot, not an appended section. This module is that slot.
//
// THE HYDRATION CONTRACT (the same pattern the fleet's prerendered donors
// use): the prerendered HTML was built with NO island, so useSyncExternalStore
// returns the EMPTY server snapshot during the hydration render — the client's
// first paint matches the shipped markup exactly and React never tears the
// tree. The island was parsed before the first commit, so the store's real
// snapshot lands on the very next commit. Verified content wins; template
// defaults render only when nothing verified exists.
import { useSyncExternalStore } from "react";
import { site, services as templateServices, templateFaqs } from "./site";

// ---------------------------------------------------------------------------
// Island types (wss-content-v1). Tolerant on purpose: the engine owns the
// writer, the donor only reads.
// ---------------------------------------------------------------------------
export type WsscFacts = {
  business_name?: string;
  city?: string;
  address_city?: string;
  state?: string;
  phone?: string;
  phone_digits?: string;
  email?: string;
  address?: string;
  license?: string;
  rating?: string | number | null;
  review_count?: string | number | null;
  logo_url?: string;
  site_url?: string;
};

export type WsscReview = { name?: string; author?: string; city?: string; text?: string; rating?: number | string };

export type Wssc = {
  facts?: WsscFacts;
  services?: unknown;
  faqs?: unknown;
  reviews?: unknown;
  areas?: unknown;
  hours?: unknown;
  about?: unknown;
};

const EMPTY: Wssc = Object.freeze({});

// Token fallbacks: on a plain hydrated build (no island) the substituted token
// literals are the truth. Every one of them is a WHOLE string literal, which is
// what the hydrator's unguarded-slot lint requires of an optional token.
function tokenFacts(): WsscFacts {
  return {
    business_name: site.name,
    city: site.city,
    address_city: site.address.locality,
    state: site.state,
    phone: site.phone,
    phone_digits: site.phoneTel,
    email: site.email,
    license: "{{LICENSE}}",
    rating: "{{RATING}}",
    review_count: "{{REVIEW_COUNT}}",
    logo_url: site.logoUrl,
    site_url: site.url,
  };
}

let cached: Wssc | null = null;

function resolve(): Wssc {
  if (typeof window === "undefined") return EMPTY;
  if (cached) return cached;
  let raw: unknown = undefined;
  try {
    raw = (window as unknown as { __WSS_CONTENT__?: unknown }).__WSS_CONTENT__;
  } catch {
    raw = undefined;
  }
  const island = raw && typeof raw === "object" ? (raw as Wssc) : EMPTY;
  cached = Object.freeze({ ...island, facts: { ...tokenFacts(), ...(island.facts || {}) } });
  return cached;
}

// The island is written before this module boots and never changes, so there
// is nothing to subscribe to; React still re-syncs after hydration because the
// resolved snapshot differs from the server snapshot.
const subscribe = () => () => undefined;

/** The verified island, token-facts merged underneath. Empty on the server. */
export function useWssc(): Wssc {
  return useSyncExternalStore(subscribe, resolve, () => EMPTY);
}

// ---------------------------------------------------------------------------
// Derived live arrays — JSX usages point at THESE, never at the templates.
// ---------------------------------------------------------------------------

export type LiveService = { title: string; short: string; slug?: string; href: string };

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Verified services from the island; the design's template cards otherwise. */
export function useLiveServices(): LiveService[] {
  const wssc = useWssc();
  const raw = wssc.services;
  const list = Array.isArray(raw)
    ? raw
        .map((s) => {
          if (typeof s === "string") return { title: s, short: "" };
          const o = (s || {}) as { name?: unknown; title?: unknown; description?: unknown; text?: unknown };
          return { title: asString(o.name) || asString(o.title), short: asString(o.description) || asString(o.text) };
        })
        .filter((s) => s.title)
    : [];
  if (list.length) {
    // A live service has no template detail page behind it, so its card routes
    // to the estimate form rather than to a page about a different service.
    return list.map((s) => ({ ...s, href: "/contact" }));
  }
  return templateServices.map((s) => ({ title: s.title, short: s.short, slug: s.slug, href: `/${s.slug}` }));
}

/** Verified FAQs from the island; neutral template FAQs otherwise. */
export function useLiveFaqs(): { q: string; a: string }[] {
  const wssc = useWssc();
  const raw = wssc.faqs;
  const list = Array.isArray(raw)
    ? raw
        .map((f) => {
          const o = (f || {}) as { q?: unknown; question?: unknown; a?: unknown; answer?: unknown };
          return { q: asString(o.q) || asString(o.question), a: asString(o.a) || asString(o.answer) };
        })
        .filter((f) => f.q && f.a)
    : [];
  return list.length ? list : templateFaqs;
}

/** Verified service areas from the island; the market city otherwise. */
export function useLiveAreas(): string[] {
  const wssc = useWssc();
  const raw = wssc.areas;
  const list = Array.isArray(raw) ? raw.map((a) => asString(a)).filter(Boolean) : [];
  if (list.length) return list;
  return [site.city];
}

export function slugify(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "area";
}

/** Verified reviews; empty when none were published. */
export function useLiveReviews(): { name: string; city: string; text: string; rating: number }[] {
  const wssc = useWssc();
  const raw = wssc.reviews;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (r || {}) as WsscReview;
      const rating = Number(o.rating);
      return {
        name: asString(o.name) || asString(o.author),
        city: asString(o.city),
        text: asString(o.text),
        rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 5,
      };
    })
    .filter((r) => r.text);
}

/** Published hours, as plain display lines; empty when none were published. */
export function useLiveHours(): string[] {
  const wssc = useWssc();
  const raw = wssc.hours;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => {
      if (typeof h === "string") return h.trim();
      if (h && typeof h === "object") {
        const o = h as { day?: unknown; hours?: unknown; open?: unknown; close?: unknown };
        const day = asString(o.day);
        const hours = asString(o.hours);
        if (day && hours) return `${day}: ${hours}`;
        if (hours) return hours;
        if (day) return day;
      }
      return "";
    })
    .filter(Boolean);
}

/** The published "about" story; empty string when none was published. */
export function useLiveAbout(): string {
  return asString(useWssc().about);
}

/** Identity facts for CTA wiring: phone/email/license/rating resolve island-first. */
export function useLiveIdentity() {
  const f = useWssc().facts || {};
  const ratingNum = Number(f.rating);
  const reviewNum = Number(f.review_count);
  return {
    phone: asString(f.phone),
    phoneDigits: asString(f.phone_digits),
    email: asString(f.email),
    address: asString(f.address),
    license: asString(f.license),
    rating: Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum : 0,
    reviewCount: Number.isFinite(reviewNum) && reviewNum > 0 ? reviewNum : 0,
    logoUrl: asString(f.logo_url),
    profileUrl: asString(site.profileUrl),
    businessName: asString(f.business_name) || site.name,
    city: asString(f.city) || site.city,
    state: asString(f.state) || site.state,
  };
}

/** A maps embed q= query for the resolved business + market — never a donor map id. */
export function useMapEmbedUrl(): string {
  const id = useLiveIdentity();
  if (!id.businessName) return "";
  const q = `${id.businessName} ${id.city}`.trim();
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}
