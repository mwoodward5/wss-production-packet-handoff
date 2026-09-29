// Lightweight GA4 event bridge. Reads gtag injected in __root.tsx head().
// Every clickable CTA in the site uses `data-event="..."`; this module
// turns every such click into a GA4 event with useful conversion context.

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag === "function") {
    window.gtag("event", name, params);
  } else if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: name, ...params });
  }
}

const LEAD_EVENTS = new Set([
  "click_call",
  "click_sms",
  "click_directions",
  "click_financing",
  "check_inventory",
  "exit_call",
  "exit_text",
]);

export function installClickTracking() {
  if (typeof document === "undefined") return;
  if ((window as any).__ldClickTrackingInstalled) return;
  (window as any).__ldClickTrackingInstalled = true;

  document.addEventListener(
    "click",
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-event]"
      );
      if (!target) return;
      const event = target.getAttribute("data-event");
      if (!event) return;
      const label =
        target.getAttribute("data-label") ||
        target.getAttribute("aria-label") ||
        target.textContent?.trim().slice(0, 80) ||
        undefined;
      const href = (target as HTMLAnchorElement).href || undefined;

      trackEvent(event, {
        cta_label: label,
        link_url: href,
        page_path: window.location.pathname,
      });

      // Mirror lead-style clicks as a GA4 'generate_lead' conversion so they
      // show up in the standard Conversions report.
      if (LEAD_EVENTS.has(event)) {
        trackEvent("generate_lead", {
          method: event,
          cta_label: label,
          page_path: window.location.pathname,
        });
      }
    },
    { capture: true }
  );
}
