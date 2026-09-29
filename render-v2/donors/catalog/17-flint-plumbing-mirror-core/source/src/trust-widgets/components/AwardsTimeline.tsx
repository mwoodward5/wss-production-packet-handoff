import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";

/** Vertical awards timeline, newest first. */
export function AwardsTimeline() {
  const cfg = useTrust();
  const awards = [...(cfg.proof.awards ?? [])].sort((a, b) => b.year.localeCompare(a.year));
  return (
    <Gate id="AwardsTimeline" when={awards.length > 0}>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, borderLeft: "1px solid var(--tw-line)" }}>
        {awards.map((a) => (
          <li key={a.id} style={{ padding: ".9rem 0 .9rem 1.2rem", position: "relative" }}>
            <span aria-hidden="true" style={{ position: "absolute", left: -5, top: "1.35rem", width: 9, height: 9, borderRadius: 999, background: "var(--tw-accent)" }} />
            <div className="tw-row" style={{ gap: ".6rem" }}>
              <strong style={{ fontFamily: "var(--tw-font-heading)" }}>{a.year}</strong>
              <span>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer nofollow">{a.title}</a> : a.title}</span>
            </div>
            {a.issuer ? <p className="tw-muted" style={{ margin: ".15rem 0 0", fontSize: ".82rem" }}>{a.issuer}</p> : null}
          </li>
        ))}
      </ol>
    </Gate>
  );
}
