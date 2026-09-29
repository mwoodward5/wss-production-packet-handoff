import { useMemo, useRef, useState, useEffect } from "react";
import { ChapterMark, Epigraph } from "@/components/ChapterMark";
import { edgeStages, edgeTabs, type EdgeTab } from "@/data/edge-progression";
import { EdgeStageCard } from "./EdgeStageCard";

export function EdgeProgression() {
  const [tab, setTab] = useState<EdgeTab["id"]>("all");

  const stages = useMemo(() => {
    const active = edgeTabs.find((t) => t.id === tab)!;
    if (active.match.length === 0) return edgeStages;
    return edgeStages.filter((s) => active.match.includes(s.category));
  }, [tab]);

  const trackRef = useRef<HTMLDivElement>(null);

  return (
    <section
      aria-labelledby="edge-h"
      className="relative bg-ink py-24 md:py-32"
    >
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="eyebrow text-edge">The Edge Progression · VIII</span>
          <ChapterMark n="VIII" />
        </div>
        <div className="mt-6 grid grid-cols-12 items-end gap-8">
          <h2
            id="edge-h"
            className="col-span-12 max-w-3xl font-serif text-4xl leading-[1.02] tracking-[-0.02em] text-bone md:col-span-7 md:text-6xl"
          >
            A path, not a promise.
            <span className="block italic text-bone-dim">
              From first contact to pressure-tested skill.
            </span>
          </h2>
          <div className="col-span-12 md:col-span-5">
            <p className="max-w-md text-[15px] leading-relaxed text-bone-dim">
              Body control, Sambo entries, Combat SAMBO decision-making, blade
              and edged-weapon awareness, seminar intensives, Cabo immersion,
              online semi-private coaching, and proof-backed media. A serious
              path for beginners and a credible standard for advanced
              practitioners.
            </p>
          </div>
        </div>

        {/* Tab rail */}
        <TabRail active={tab} onChange={setTab} />

        {/* Desktop diagonal progression */}
        <div className="mt-10 hidden md:block">
          <div className="relative">
            {/* connector spine — subtle horizontal line under the row */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0"
              style={{
                top: "56%",
                height: 1,
                background:
                  "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--edge) 45%, transparent) 12%, color-mix(in oklab, var(--edge) 45%, transparent) 88%, transparent 100%)",
              }}
            />
            <div
              ref={trackRef}
              role="tabpanel"
              aria-labelledby={`edge-tab-${tab}`}
              className="flex gap-8 overflow-x-auto pb-8 pt-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-edge/50"
              style={{ scrollSnapType: "x mandatory" }}
            >
              {stages.map((s, i) => (
                <div
                  key={s.n}
                  className="shrink-0"
                  style={{
                    width: "clamp(300px, 26vw, 360px)",
                    scrollSnapAlign: "start",
                    transform: `translateY(${i % 2 === 0 ? 0 : 28}px)`,
                  }}
                >
                  <RevealOnce delayMs={i * 60}>
                    <EdgeStageCard stage={s} />
                  </RevealOnce>
                </div>
              ))}
            </div>
          </div>

          {/* Scroll controls */}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => trackRef.current?.scrollBy({ left: -380, behavior: "smooth" })}
              className="glass eyebrow h-11 w-11 rounded-full text-bone"
              aria-label="Scroll progression left"
            >←</button>
            <button
              onClick={() => trackRef.current?.scrollBy({ left: 380, behavior: "smooth" })}
              className="glass eyebrow h-11 w-11 rounded-full text-bone"
              aria-label="Scroll progression right"
            >→</button>
          </div>
        </div>

        {/* Mobile stacked progression */}
        <div className="mt-8 md:hidden" role="tabpanel" aria-labelledby={`edge-tab-${tab}`}>
          <div
            className="relative pl-6"
            style={{
              backgroundImage:
                "linear-gradient(to bottom, color-mix(in oklab, var(--edge) 45%, transparent), color-mix(in oklab, var(--edge) 45%, transparent))",
              backgroundSize: "1px 100%",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "8px 0",
            }}
          >
            <ul className="space-y-14">
              {stages.map((s, i) => (
                <li key={s.n} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-6 top-3 grid h-3 w-3 place-items-center rounded-full"
                    style={{ background: "var(--edge)", boxShadow: "0 0 0 3px var(--ink)" }}
                  />
                  <RevealOnce delayMs={i * 40}>
                    <EdgeStageCard stage={s} layout="mobile" />
                  </RevealOnce>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Closing epigraph */}
        <div className="mt-16 max-w-md">
          <Epigraph
            text="Structured. Live resistance. Direct instruction."
            credit="Bajo El Filo · lineage-aware"
          />
        </div>
      </div>
    </section>
  );
}

/* ---------------- Tab Rail ---------------- */

function TabRail({
  active,
  onChange,
}: {
  active: EdgeTab["id"];
  onChange: (id: EdgeTab["id"]) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLButtonElement>(`[data-tab-id="${active}"]`);
    if (!el) return;
    const listRect = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setIndicator({ left: r.left - listRect.left + list.scrollLeft, width: r.width });
  }, [active]);

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = edgeTabs.findIndex((t) => t.id === active);
    const next =
      e.key === "ArrowRight"
        ? edgeTabs[(i + 1) % edgeTabs.length]
        : edgeTabs[(i - 1 + edgeTabs.length) % edgeTabs.length];
    onChange(next.id);
  };

  return (
    <div className="mt-12 md:sticky md:top-16 md:z-10">
      <div className="border-y border-hairline bg-ink/85 backdrop-blur">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Edge progression categories"
          onKeyDown={onKeyDown}
          className="relative flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {edgeTabs.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                id={`edge-tab-${t.id}`}
                data-tab-id={t.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => onChange(t.id)}
                className="shrink-0 px-4 py-3 text-[11px] uppercase tracking-[0.2em] transition-colors"
                style={{
                  scrollSnapAlign: "start",
                  color: isActive ? "var(--bone)" : "var(--bone-dim)",
                }}
              >
                {t.label}
              </button>
            );
          })}
          {/* underline indicator */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0 h-[2px] bg-edge motion-safe:transition-all motion-safe:duration-[240ms] motion-safe:ease-out"
            style={{
              left: indicator.left,
              width: indicator.width,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------- RevealOnce ---------------- */

function RevealOnce({
  children,
  delayMs = 0,
}: {
  children: React.ReactNode;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(12px)",
        transition: `opacity 500ms ease-out ${delayMs}ms, transform 500ms ease-out ${delayMs}ms`,
      }}
    >
      {children}
    </div>
  );
}
