// Lightweight dataLayer wrapper for analytics events, if a container ever
// exists. Nothing here carries an account id.

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export function track(event: string, params: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

export const trackPhoneClick = (location: string) => track("phone_click", { location });
export const trackFormSubmit = (form: string) => track("form_submit", { form });
export const trackQuoteSubmit = (step: string) => track("quote_submit", { step });
export const trackReviewClick = (location: string) => track("review_click", { location });
