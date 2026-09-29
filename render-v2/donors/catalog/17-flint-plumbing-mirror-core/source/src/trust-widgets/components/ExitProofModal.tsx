import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useFocusTrap, Stars } from "./primitives";
import { aggregateRatingOf } from "../seo/jsonld";

/**
 * Desktop exit-intent modal that leads with proof, not a discount.
 * Fires once per session, never on touch devices, never with reduced motion preferences ignored.
 */
export function ExitProofModal({
  storageKey = "tw-exit-proof",
  onSubmitEmail,
  headline,
}: {
  storageKey?: string;
  onSubmitEmail?: (email: string) => void | Promise<void>;
  headline?: string;
}) {
  const cfg = useTrust();
  const agg = aggregateRatingOf(cfg);
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const panelRef = useFocusTrap(open, close);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (sessionStorage.getItem(storageKey)) return;
    const onLeave = (e: MouseEvent) => {
      if (e.clientY > 0) return;
      sessionStorage.setItem(storageKey, "1");
      setOpen(true);
    };
    document.addEventListener("mouseout", onLeave);
    return () => document.removeEventListener("mouseout", onLeave);
  }, [storageKey]);

  const cta = cfg.contact.bookingUrl ?? cfg.contact.quoteUrl;
  return (
    <Gate id="ExitProofModal" when={open}>
      <div className="tw-modal" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div ref={panelRef} className="tw-modal__panel" role="dialog" aria-modal="true" aria-label="Before you go" tabIndex={-1}>
          <div className="tw-row" style={{ justifyContent: "space-between" }}>
            <h2 className="tw-h tw-h3" style={{ margin: 0 }}>
              {headline ?? `Before you go — see why ${cfg.labels.customerNounPlural} choose ${cfg.business.name}`}
            </h2>
            <button type="button" className="tw-btn tw-btn--ghost" onClick={close} aria-label="Close">×</button>
          </div>

          {agg ? (
            <p className="tw-row" style={{ marginTop: ".8rem" }}>
              <Stars value={agg.ratingValue as number} /> <strong>{agg.ratingValue}</strong>
              <span className="tw-muted">from {agg.reviewCount} verified reviews</span>
            </p>
          ) : null}

          {(cfg.proof.guarantees ?? []).slice(0, 3).map((g) => (
            <p key={g.id} style={{ margin: ".4rem 0", fontSize: ".9rem" }}><strong>{g.title}</strong> <span className="tw-muted">— {g.detail}</span></p>
          ))}

          {sent ? (
            <p style={{ marginTop: "1rem" }}>Thanks — we&apos;ll be in touch shortly.</p>
          ) : onSubmitEmail ? (
            <form
              className="tw-row"
              style={{ marginTop: "1rem" }}
              onSubmit={async (e) => { e.preventDefault(); await onSubmitEmail(email); setSent(true); }}
            >
              <label className="tw-sr" htmlFor="tw-exit-email">Email address</label>
              <input id="tw-exit-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                style={{ flex: 1, minWidth: 200, minHeight: 44, background: "var(--tw-surface-alt)", color: "var(--tw-text)", border: "1px solid var(--tw-line)", borderRadius: "var(--tw-radius)", padding: "0 .8rem", font: "inherit" }} />
              <button type="submit" className="tw-btn tw-btn--primary">Send me details</button>
            </form>
          ) : cta ? (
            <a className="tw-btn tw-btn--primary" style={{ marginTop: "1rem" }} href={cta}>{cfg.labels.bookCta}</a>
          ) : null}
        </div>
      </div>
    </Gate>
  );
}
