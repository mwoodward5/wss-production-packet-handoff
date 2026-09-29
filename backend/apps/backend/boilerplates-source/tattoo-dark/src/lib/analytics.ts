// Lightweight analytics event hook. Wire a real provider by setting VITE_ANALYTICS_URL.
export function track(event: string, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  try {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", event, props);
    const url = import.meta.env.VITE_ANALYTICS_URL as string | undefined;
    if (url) {
      const blob = new Blob([JSON.stringify({ event, props, ts: Date.now(), path: window.location.pathname })], {
        type: "application/json",
      });
      navigator.sendBeacon?.(url, blob);
    }
  } catch {
    // swallow
  }
}
