import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Accreditation / partner / platform badges. */
export function TrustBadgeRail({ grayscale = true }: { grayscale?: boolean }) {
  const cfg = useTrust();
  const badges = cfg.proof.badges ?? [];
  return (
    <Gate id="TrustBadgeRail" when={badges.length > 0}>
      <ul className="tw-row" style={{ listStyle: "none", margin: 0, padding: 0, gap: "1.2rem", justifyContent: "center" }}>
        {badges.map((b) => {
          const body = b.logoUrl
            ? <img src={b.logoUrl} alt={b.label} height={38} loading="lazy"
                   style={{ height: 38, width: "auto", filter: grayscale ? "grayscale(1)" : undefined, opacity: grayscale ? .85 : 1 }} />
            : <span className="tw-chip">{b.label}</span>;
          return (
            <li key={b.id} title={b.detail}>
              {b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${b.label} (opens in a new tab)`}>{body}</a> : body}
            </li>
          );
        })}
      </ul>
    </Gate>
  );
}
