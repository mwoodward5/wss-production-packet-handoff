import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { useFocusTrap } from "./primitives";

/** Tag-filterable gallery with an accessible lightbox and a conversion CTA. */
export function PortfolioLightbox({ ctaHref, ctaLabel }: { ctaHref?: string; ctaLabel?: string }) {
  const cfg = useTrust();
  const items = cfg.proof.gallery ?? [];
  const tags = Array.from(new Set(items.flatMap((i) => i.tags ?? [])));
  const [tag, setTag] = React.useState("All");
  const [open, setOpen] = React.useState<number | null>(null);
  const close = React.useCallback(() => setOpen(null), []);
  const panelRef = useFocusTrap(open !== null, close);

  const filtered = tag === "All" ? items : items.filter((i) => i.tags?.includes(tag));
  const current = open !== null ? filtered[open] : undefined;
  const href = ctaHref ?? cfg.contact.bookingUrl ?? cfg.contact.quoteUrl;

  React.useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((n) => ((n ?? 0) + 1) % filtered.length);
      if (e.key === "ArrowLeft") setOpen((n) => ((n ?? 0) - 1 + filtered.length) % filtered.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered.length]);

  return (
    <Gate id="PortfolioLightbox" when={items.length > 0}>
      <div>
        {tags.length > 1 ? (
          <div className="tw-row" role="group" aria-label={`Filter ${cfg.labels.galleryTitle}`} style={{ marginBottom: "1rem" }}>
            {["All", ...tags].map((t) => (
              <button key={t} type="button" className="tw-btn" aria-pressed={tag === t}
                style={tag === t ? { borderColor: "var(--tw-accent)" } : undefined}
                onClick={() => { setTag(t); setOpen(null); }}>{t}</button>
            ))}
          </div>
        ) : null}

        <div className="tw-tiles">
          {filtered.map((m, i) => (
            <button key={m.id} type="button" className="tw-tile" onClick={() => setOpen(i)}
                    aria-label={`View larger: ${m.alt}`}>
              <img className="tw-img" src={m.src} alt={m.alt} loading="lazy" width={m.width} height={m.height} />
            </button>
          ))}
        </div>

        {current ? (
          <div className="tw-lb" onMouseDown={(e) => e.target === e.currentTarget && close()}>
            <div ref={panelRef} role="dialog" aria-modal="true" aria-label={current.alt} tabIndex={-1} style={{ textAlign: "center" }}>
              <img className="tw-lb__img" src={current.src} alt={current.alt} />
              <div className="tw-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
                <button type="button" className="tw-btn tw-btn--ghost" onClick={() => setOpen((n) => ((n ?? 0) - 1 + filtered.length) % filtered.length)} aria-label="Previous image">←</button>
                <p className="tw-muted" style={{ margin: 0, maxWidth: "52ch", fontSize: ".85rem" }}>{current.caption ?? current.alt}</p>
                <button type="button" className="tw-btn tw-btn--ghost" onClick={() => setOpen((n) => ((n ?? 0) + 1) % filtered.length)} aria-label="Next image">→</button>
              </div>
              {href ? (
                <a className="tw-btn tw-btn--primary" style={{ marginTop: "1rem" }} href={href}>
                  {ctaLabel ?? `${cfg.labels.bookVerb} something like this`}
                </a>
              ) : null}
              <button type="button" className="tw-btn tw-lb__close" onClick={close} aria-label="Close gallery">×</button>
            </div>
          </div>
        ) : null}
      </div>
    </Gate>
  );
}
