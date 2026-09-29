import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

function expired(c: { expiresAt?: string }) {
  return Boolean(c.expiresAt && new Date(c.expiresAt) < new Date());
}

/**
 * License number + one-click verification link.
 * Expired credentials are hidden rather than shown stale.
 */
export function LicenseVerifyBadge() {
  const cfg = useTrust();
  const licenses = (cfg.proof.credentials ?? []).filter((c) => (c.kind ?? "license") === "license" && c.number && !expired(c));
  return (
    <Gate id="LicenseVerifyBadge" when={licenses.length > 0}>
      <ul className="tw-row" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {licenses.map((c) => (
          <li key={c.id} className="tw-chip" style={{ color: "var(--tw-text)" }}>
            <span aria-hidden="true">✓</span>
            <span>{c.name} #{c.number}</span>
            <span className="tw-muted">{c.issuer}</span>
            {c.verifyUrl ? (
              <a href={c.verifyUrl} target="_blank" rel="noopener noreferrer nofollow" style={{ fontSize: ".78rem" }}>
                Verify
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </Gate>
  );
}
