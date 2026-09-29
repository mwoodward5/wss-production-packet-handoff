const KEY = "wss_utm";

export type UtmData = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
  landing_path?: string;
};

/** Capture UTM + referrer on first visit. Idempotent per session. */
export function captureUtm() {
  if (typeof window === "undefined") return;
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return;
    const params = new URLSearchParams(window.location.search);
    const data: UtmData = {
      utm_source: params.get("utm_source") ?? undefined,
      utm_medium: params.get("utm_medium") ?? undefined,
      utm_campaign: params.get("utm_campaign") ?? undefined,
      referrer: document.referrer || undefined,
      landing_path: window.location.pathname + window.location.search,
    };
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function readUtm(): UtmData {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as UtmData) : {};
  } catch {
    return {};
  }
}
