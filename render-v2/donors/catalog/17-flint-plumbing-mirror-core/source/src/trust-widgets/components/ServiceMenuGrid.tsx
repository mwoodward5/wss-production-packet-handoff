import * as React from "react";
import { clientData } from "@/wss-bridge";
import { Gate, useTrust } from "../TrustProvider";

function price(s: { priceFrom?: number; priceTo?: number; priceUnit?: string; currency?: string }) {
  if (!s.priceFrom) return null;
  const c = s.currency === "USD" || !s.currency ? "$" : `${s.currency} `;
  return `${c}${s.priceFrom}${s.priceTo ? `–${c}${s.priceTo}` : "+"}${s.priceUnit ? ` ${s.priceUnit}` : ""}`;
}

/** Priced service menu — the block AI Overviews and voice assistants quote most. */
export function ServiceMenuGrid() {
  const cfg = useTrust();
  const services = cfg.services ?? [];
  const href = cfg.contact.bookingUrl ?? cfg.contact.quoteUrl;
  return (
    <Gate id="ServiceMenuGrid" when={services.length > 0}>
      <div className="tw-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))" }}>
        {services.map((s) => (
          <article key={s.id} className="tw-card" style={s.popular ? { borderColor: "var(--tw-accent)" } : undefined}>
            {s.image ? (
              <div style={{ aspectRatio: "16/9", borderRadius: "var(--tw-radius)", overflow: "hidden", marginBottom: ".8rem" }}>
                <img className="tw-img" src={s.image} alt={s.name} loading="lazy" />
              </div>
            ) : null}
            <div className="tw-row" style={{ justifyContent: "space-between" }}>
              <h3 className="tw-h tw-h3" style={{ margin: 0, fontSize: "1.02rem" }}>{clientData.services.find(item => item.name === s.name)?.href ? <a href={clientData.services.find(item => item.name === s.name)!.href}>{s.name}</a> : s.name}</h3>
              {s.popular ? <span className="tw-chip" style={{ color: "var(--tw-text)" }}>Most requested</span> : null}
            </div>
            {s.description ? <p className="tw-muted" style={{ fontSize: ".88rem", lineHeight: 1.5 }}>{s.description}</p> : null}
            <div className="tw-row" style={{ justifyContent: "space-between", marginTop: ".6rem" }}>
              <strong>{price(s) ?? cfg.labels.quoteCta}</strong>
              {s.durationMin ? <span className="tw-muted" style={{ fontSize: ".8rem" }}>{s.durationMin} min</span> : null}
            </div>
            {href ? <a className="tw-btn tw-btn--primary" style={{ marginTop: ".8rem" }} href={href}>{cfg.labels.bookVerb} {s.name}</a> : null}
          </article>
        ))}
      </div>
    </Gate>
  );
}
