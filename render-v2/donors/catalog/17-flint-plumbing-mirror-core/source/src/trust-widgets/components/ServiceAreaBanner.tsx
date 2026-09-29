import * as React from "react";
import { areaSlug, nearMePath } from "@/lib/areas";
import { Gate, useTrust } from "../TrustProvider";
import { useVisitorArea } from "../hooks/useVisitorArea";

/**
 * "Serving <your city>" near-me banner.
 * Falls back to the configured service-area list when location is denied/unavailable.
 */
export function ServiceAreaBanner({ askOnMount = false }: { askOnMount?: boolean }) {
  const cfg = useTrust();
  const areas = cfg.location.serviceAreas ?? [];
  const primary = cfg.location.primary;
  const { status, city, distanceKm, request } = useVisitorArea(cfg);

  React.useEffect(() => { if (askOnMount) request(); }, [askOnMount, request]);

  const has = Boolean(primary || areas.length);
  const resolved = status === "resolved" && city;

  return (
    <Gate id="ServiceAreaBanner" when={has}>
      <div className="tw-card tw-row" style={{ justifyContent: "space-between" }} aria-live="polite">
        <p style={{ margin: 0, fontSize: ".92rem" }}>
          {resolved ? (
            <>Serving <strong>{city}</strong>{typeof distanceKm === "number" ? ` — about ${distanceKm} km from our ${primary?.label ?? "shop"}` : ""}.</>
          ) : (
            <>
              Serving {primary?.city ? <strong>{primary.city}</strong> : null}
              {areas.map(a => <a key={a} className="tw-chip" href={nearMePath(areaSlug(a))}>{a}</a>)}
              {cfg.location.serviceRadiusKm ? <> — within {cfg.location.serviceRadiusKm} km.</> : "."}
            </>
          )}
        </p>
        {!resolved && cfg.options?.allowGeolocationPrompt ? (
          <button type="button" className="tw-btn" onClick={request}>Check my area</button>
        ) : null}
      </div>
    </Gate>
  );
}
