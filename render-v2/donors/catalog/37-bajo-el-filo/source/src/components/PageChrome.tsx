import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function PageHero({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub: string }) {
  return (
    <section className="relative overflow-hidden border-b border-hairline bg-ink pt-40 md:pt-48">
      <div className="mx-auto max-w-[1440px] px-6 pb-20 md:px-10">
        <div className="flex items-center gap-3">
          <span className="h-px w-12 bg-edge" />
          <span className="eyebrow text-edge">{eyebrow}</span>
        </div>
        <h1 className="anim-fade-up mt-6 max-w-4xl font-serif text-5xl leading-[1] tracking-[-0.025em] text-bone md:text-8xl">
          {title}
        </h1>
        <p className="mt-8 max-w-xl text-steel md:text-lg">{sub}</p>
      </div>
    </section>
  );
}

export function ClosingCTA() {
  return (
    <section className="border-t border-hairline bg-ink-2 py-20">
      <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-6 px-6 md:flex-row md:items-center md:px-10">
        <div>
          <span className="eyebrow text-edge">Begin</span>
          <h2 className="mt-3 font-serif text-3xl text-bone md:text-5xl">Start with a conversation.</h2>
        </div>
        <Link to="/contact" className="eyebrow inline-flex items-center gap-3 rounded-full bg-bone px-6 py-4 text-ink">
          Send an inquiry →
        </Link>
      </div>
    </section>
  );
}
