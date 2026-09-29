import * as React from "react";

export function Stars({ value, max = 5, label }: { value: number; max?: number; label?: string }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="tw-stars" role="img" aria-label={label ?? `${value} out of ${max} stars`}>
      {Array.from({ length: max }).map((_, i) => {
        const fill = rounded >= i + 1 ? 1 : rounded >= i + 0.5 ? 0.5 : 0;
        return (
          <svg key={i} viewBox="0 0 20 20" aria-hidden="true">
            <defs>
              <linearGradient id={`tw-st-${i}-${fill}`}>
                <stop offset={`${fill * 100}%`} stopColor="currentColor" />
                <stop offset={`${fill * 100}%`} stopColor="transparent" />
              </linearGradient>
            </defs>
            <path
              d="M10 1.6l2.5 5.2 5.7.8-4.1 4 1 5.7L10 14.6 4.9 17.3l1-5.7-4.1-4 5.7-.8z"
              fill={`url(#tw-st-${i}-${fill})`}
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".55"
            />
          </svg>
        );
      })}
    </span>
  );
}

export function Section({
  title, eyebrow, children, id, className,
}: { title?: string; eyebrow?: string; children: React.ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={["tw-section", className].filter(Boolean).join(" ")}>
      <div className="tw-wrap">
        {eyebrow ? <p className="tw-eyebrow">{eyebrow}</p> : null}
        {title ? <h2 className="tw-h tw-h2">{title}</h2> : null}
        {children}
      </div>
    </section>
  );
}

/** Renders JSON-LD. Pass undefined and nothing is emitted. */
export function JsonLd({ data }: { data?: unknown }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function useInterval(cb: () => void, delayMs: number | null) {
  const saved = React.useRef(cb);
  React.useEffect(() => { saved.current = cb; }, [cb]);
  React.useEffect(() => {
    if (delayMs == null) return;
    const id = window.setInterval(() => saved.current(), delayMs);
    return () => window.clearInterval(id);
  }, [delayMs]);
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !node) return;
      const f = node.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [active, onClose]);
  return ref;
}
