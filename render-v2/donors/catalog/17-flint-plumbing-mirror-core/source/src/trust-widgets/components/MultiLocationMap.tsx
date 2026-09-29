import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { allLocations, mapLinks } from "../seo/geo";

/** Location switcher + keyless map embed + Apple/Google/Waze deep links. */
export function MultiLocationMap() {
  const cfg = useTrust();
  const locs = allLocations(cfg);
  const [id, setId] = React.useState(locs[0]?.id);
  const active = locs.find((l) => l.id === id) ?? locs[0];
  const links = mapLinks(active);

  return (
    <Gate id="MultiLocationMap" when={locs.length > 0}>
      <div className="tw-grid" style={{ gridTemplateColumns: "minmax(240px,1fr) 2fr", alignItems: "start" }}>
        <div>
          {locs.length > 1 ? (
            <ul style={{ listStyle: "none", margin: "0 0 1rem", padding: 0, display: "grid", gap: ".5rem" }}>
              {locs.map((l) => (
                <li key={l.id}>
                  <button type="button" className="tw-btn" aria-pressed={l.id === active?.id}
                    style={{ width: "100%", justifyContent: "flex-start", ...(l.id === active?.id ? { borderColor: "var(--tw-accent)" } : {}) }}
                    onClick={() => setId(l.id)}>{l.label}</button>
                </li>
              ))}
            </ul>
          ) : null}
          {active ? (
            <address className="tw-card" style={{ fontStyle: "normal", fontSize: ".9rem", lineHeight: 1.6 }}>
              <strong>{active.label}</strong><br />
              {active.street}<br />
              {active.city}, {active.region} {active.postal}
              {active.phone ? <><br /><a href={`tel:${active.phone}`}>{active.phone}</a></> : null}
              <span className="tw-row" style={{ marginTop: ".8rem" }}>
                <a className="tw-btn" href={links?.apple} target="_blank" rel="noopener noreferrer">Apple Maps</a>
                <a className="tw-btn" href={links?.google} target="_blank" rel="noopener noreferrer">Google</a>
                <a className="tw-btn" href={links?.waze} target="_blank" rel="noopener noreferrer">Waze</a>
              </span>
            </address>
          ) : null}
        </div>
        {links ? (
          <iframe
            title={`Map to ${active?.label}`}
            src={active?.mapUrl ?? links.embed}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            style={{ width: "100%", minHeight: 340, border: "1px solid var(--tw-line)", borderRadius: "var(--tw-radius-lg)" }}
          />
        ) : null}
      </div>
    </Gate>
  );
}
