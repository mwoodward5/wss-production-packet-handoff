import * as React from "react";
import type { TrustConfig } from "../trust.config";
import { distanceKm, nearestLocation } from "../seo/geo";

export interface VisitorArea {
  status: "idle" | "asking" | "resolved" | "denied" | "unsupported";
  city?: string;
  distanceKm?: number;
  nearestLocationId?: string;
}

/**
 * Coarse visitor location, used only to say "Serving <city>".
 * Never prompts unless options.allowGeolocationPrompt is true AND the caller opts in.
 */
export function useVisitorArea(cfg: TrustConfig, enabled = true): VisitorArea & { request: () => void } {
  const [state, setState] = React.useState<VisitorArea>({ status: "idle" });

  const request = React.useCallback(() => {
    if (!enabled || !cfg.options?.allowGeolocationPrompt) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unsupported" });
      return;
    }
    setState({ status: "asking" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const near = nearestLocation(cfg, here);
        setState({
          status: "resolved",
          city: near?.location.city,
          nearestLocationId: near?.location.id,
          distanceKm: near ? Math.round(distanceKm(here, near.geo)) : undefined,
        });
      },
      () => setState({ status: "denied" }),
      { maximumAge: 600_000, timeout: 8000, enableHighAccuracy: false }
    );
  }, [cfg, enabled]);

  return { ...state, request };
}
