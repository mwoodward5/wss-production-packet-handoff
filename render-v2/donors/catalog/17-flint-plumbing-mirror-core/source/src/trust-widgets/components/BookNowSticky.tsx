import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { telHref } from "../seo/geo";

/**
 * Mobile-first sticky action bar. Add className="tw-has-sticky" to <body>/page
 * wrapper so it never covers interactive content.
 */
export function BookNowSticky({ showAfterPx = 480 }: { showAfterPx?: number }) {
  const cfg = useTrust();
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setShow(window.scrollY > showAfterPx);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showAfterPx]);

  const book = cfg.contact.bookingUrl ?? cfg.contact.quoteUrl;
  const tel = telHref(cfg.contact.phone);
  return (
    <Gate id="BookNowSticky" when={Boolean(book || tel) && show}>
      <div className="tw-sticky-bottom tw-row" style={{ justifyContent: "space-between" }} role="region" aria-label="Quick actions">
        <span className="tw-muted" style={{ fontSize: ".85rem" }}>{cfg.business.name}</span>
        <span className="tw-row">
          {tel ? <a className="tw-btn" href={tel}>Call {cfg.contact.phoneDisplay ?? ""}</a> : null}
          {book ? <a className="tw-btn tw-btn--primary" href={book}>{cfg.labels.bookCta}</a> : null}
        </span>
      </div>
    </Gate>
  );
}
