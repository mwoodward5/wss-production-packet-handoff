import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { smsHref, telHref } from "../seo/geo";

/** High-contrast emergency band for trades that take 2am calls. */
export function EmergencyCTABand() {
  const cfg = useTrust();
  const em = cfg.availability.emergency;
  const phone = em?.phone ?? cfg.contact.phone;
  return (
    <Gate id="EmergencyCTABand" when={Boolean(em?.available && phone)}>
      <div className="tw-card tw-row" style={{ justifyContent: "space-between", background: "var(--tw-accent)", color: "var(--tw-accent-text)", borderColor: "transparent" }}>
        <div>
          <strong style={{ fontFamily: "var(--tw-font-heading)", fontSize: "1.1rem" }}>
            {em?.label ?? cfg.labels.emergencyLabel ?? "24/7 emergency service"}
          </strong>
          {em?.note ? <p style={{ margin: ".25rem 0 0", fontSize: ".86rem", opacity: .92 }}>{em.note}</p> : null}
          {typeof cfg.availability.responseTimeMinutes === "number" ? (
            <p style={{ margin: ".25rem 0 0", fontSize: ".86rem", opacity: .92 }}>
              Typical on-site response: {cfg.availability.responseTimeMinutes} minutes
            </p>
          ) : null}
        </div>
        <span className="tw-row">
          <a className="tw-btn" style={{ background: "var(--tw-accent-text)", color: "var(--tw-accent)", borderColor: "transparent" }} href={telHref(phone)}>
            Call {cfg.contact.phoneDisplay ?? phone}
          </a>
          {cfg.contact.sms ? <a className="tw-btn" style={{ background: "transparent", color: "var(--tw-accent-text)", borderColor: "currentColor" }} href={smsHref(cfg.contact.sms, "I need urgent help with:")}>Text us</a> : null}
        </span>
      </div>
    </Gate>
  );
}
