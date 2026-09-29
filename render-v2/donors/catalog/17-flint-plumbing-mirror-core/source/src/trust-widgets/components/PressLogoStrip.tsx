import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** "As seen in" strip with optional pull quote. */
export function PressLogoStrip() {
  const cfg = useTrust();
  const press = cfg.proof.press ?? [];
  const quoted = press.find((p) => p.quote);
  return (
    <Gate id="PressLogoStrip" when={press.length > 0}>
      <div style={{ textAlign: "center" }}>
        <p className="tw-eyebrow">As featured in</p>
        <ul className="tw-row" style={{ listStyle: "none", margin: 0, padding: 0, gap: "1.6rem", justifyContent: "center" }}>
          {press.map((p) => (
            <li key={p.id}>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="tw-muted" style={{ textDecoration: "none" }}>
                  {p.logoUrl ? <img src={p.logoUrl} alt={p.outlet} height={26} style={{ height: 26, width: "auto", opacity: .8 }} loading="lazy" /> : p.outlet}
                </a>
              ) : (
                p.logoUrl ? <img src={p.logoUrl} alt={p.outlet} height={26} style={{ height: 26, width: "auto", opacity: .8 }} loading="lazy" /> : <span className="tw-muted">{p.outlet}</span>
              )}
            </li>
          ))}
        </ul>
        {quoted ? (
          <blockquote className="tw-muted" style={{ maxWidth: "56ch", margin: "1rem auto 0", fontSize: ".92rem" }}>
            “{quoted.quote}” — {quoted.outlet}
          </blockquote>
        ) : null}
      </div>
    </Gate>
  );
}
