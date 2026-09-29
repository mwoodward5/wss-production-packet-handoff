/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: the "review us on Google" composer — the customer
 * │ taps phrases, we assemble a draft and hand it to Google's write-review URL.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT:
 * │   clientConfig.maps.placeId        <- Places Text Search -> places[].id
 * │   clientConfig.maps.writeReviewUrl <- optional; derived from placeId when absent
 * │   clientConfig.reviewRequest.heading/blurb/phrases[] <- rewrite per trade
 * │        (phrases must name real services from trustConfig.services[])
 * │ IF YOU CANNOT SOURCE placeId: the panel hides itself. No crash.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Review request composer
 * └──────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";

import { clientConfig, writeReviewUrl } from "@/client.config";
import { trustConfig } from "@/trust.config";
import { Stars } from "@/trust-widgets/components/primitives";

/**
 * Guided Google review composer. The customer picks the phrases that match
 * their job, we assemble a draft, they copy it and post it themselves on their
 * own Google account. Nothing is ever submitted on their behalf.
 */
export function ReviewRequestPanel() {
  const rc = clientConfig.reviewRequest;
  const url = writeReviewUrl();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [closer, setCloser] = React.useState(0);
  const [copied, setCopied] = React.useState(false);

  const draft = React.useMemo(() => {
    const parts = rc.prompts.filter((p) => picked.includes(p.id)).map((p) => p.text);
    if (!parts.length) return "";
    return [...parts, rc.closers[closer % rc.closers.length]].join(" ");
  }, [picked, closer, rc]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const copy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.32em] text-mint">
          Already a customer?
        </p>
        <h2 className="font-[Archivo] text-3xl font-extrabold leading-[1.05] tracking-tight text-cream sm:text-4xl">
          {rc.heading}
        </h2>
        <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">{rc.blurb}</p>

        <div className="mt-7 flex items-center gap-3">
          <Stars value={5} />
          <span className="text-sm font-semibold text-cream">Five stars is the default</span>
        </div>

        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Review phrases">
          {rc.prompts.map((p) => {
            const on = picked.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.id)}
                className={
                  "rounded-full border px-4 py-2 text-sm font-semibold transition-all " +
                  (on
                    ? "border-coral bg-[color-mix(in_oklab,var(--coral)_22%,transparent)] text-cream shadow-float"
                    : "border-border text-muted-foreground hover:-translate-y-0.5 hover:border-mint hover:text-cream")
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setCloser((c) => c + 1)}
          className="mt-5 text-sm font-semibold text-mint underline-offset-4 hover:underline"
        >
          Shuffle the closing line
        </button>
      </div>

      <div className="glass-panel animate-float rounded-3xl p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-mint">Your draft</p>
        <label className="sr-only" htmlFor="review-draft">
          Draft review text
        </label>
        <textarea
          id="review-draft"
          value={draft}
          onChange={() => undefined}
          readOnly
          rows={7}
          placeholder="Tap a few phrases and your review appears here…"
          className="mt-4 w-full resize-none rounded-2xl border border-border bg-[color-mix(in_oklab,var(--cream)_5%,transparent)] p-4 text-[0.95rem] leading-relaxed text-cream outline-none placeholder:text-muted-foreground focus-visible:border-mint"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {draft ? `${draft.trim().split(/\s+/).length} words` : "Nothing selected yet"}
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={copy}
            disabled={!draft}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-mint disabled:cursor-not-allowed disabled:opacity-45"
          >
            {copied ? "Copied ✓" : "Copy draft"}
          </button>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-coral px-6 py-2.5 text-sm font-semibold text-accent-foreground shadow-float transition-transform hover:-translate-y-0.5"
            >
              Review us on Google
            </a>
          ) : (
            <span className="rounded-full border border-dashed border-border px-5 py-2.5 text-xs text-muted-foreground">
              Add a Google Place ID to enable the one-tap review link
            </span>
          )}
          {trustConfig.contact.phoneDisplay && (
            <a
              href={`tel:${trustConfig.contact.phone}`}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-cream transition-colors hover:border-mint"
            >
              Rather tell us directly
            </a>
          )}
        </div>

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          We never write, filter or gate reviews. The draft is a starting point you can rewrite
          entirely — it posts from your own Google account, in your own words.
        </p>
      </div>
    </div>
  );
}
