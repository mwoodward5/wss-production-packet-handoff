import {CLIENT,routeFor,richService} from "@/lib/wss";
import { Link } from "react-router-dom";
import { ArrowUpRight, Home, Layers, Droplets, Wrench } from "lucide-react";

/**
 * Roof Systems Board — Material Matrix.
 * Dense spec table: System / Best For / Scope / Materials.
 * Replaces the equal-card pattern with a contractor-grade build sheet.
 */

const SYSTEMS=CLIENT.services.map((s,i)=>({code:`RS-${String(i+1).padStart(2,'0')}`,icon:[Home,Wrench,Layers,Droplets][i%4],system:s.name,bestFor:richService(s)?.shortDesc||'',handles:s.description,materials:'',href:s.href || routeFor(s)}));

export const Services = () => (
  <section id="systems" className="relative bg-background py-20 md:py-24">
    {/* Blueprint hairline backdrop */}
    <div className="pointer-events-none absolute inset-0 blueprint-grid opacity-60" aria-hidden="true" />
    <div className="container-tight relative">
      <div className="grid gap-8 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <span className="eyebrow">Section · 02 / Material Matrix</span>
          <h2 className="heading-section mt-3">
            Roof Systems Board.{" "}
            <span className="text-accent">Read the spec.</span>
          </h2>
        </div>
        <p className="text-base text-muted-foreground md:col-span-5">
          {CLIENT.content.serviceIntro}
        </p>
      </div>

      {/* Desktop spec table */}
      <div className="mt-10 hidden overflow-hidden border border-foreground/15 bg-card md:block">
        {/* Header row */}
        <div className="grid grid-cols-[110px_1.1fr_1.2fr_1.6fr_1.6fr_44px] items-center gap-4 border-b-2 border-foreground bg-primary px-5 py-3 text-primary-foreground">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">Spec</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">System</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">Best For</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">Scope</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/70">Details</span>
          <span aria-hidden="true" />
        </div>
        {SYSTEMS.map(({ code, icon: Icon, system, bestFor, handles, materials, href }, i) => (
          <Link
            key={code}
            to={href}
            className={`group grid grid-cols-[110px_1.1fr_1.2fr_1.6fr_1.6fr_44px] items-center gap-4 border-b border-dashed border-border px-5 py-5 transition hover:bg-muted/40 ${i === SYSTEMS.length - 1 ? "border-b-0" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center border border-foreground/20 bg-background" style={{ borderRadius: "2px" }}>
                <Icon className="h-3.5 w-3.5 text-accent" />
              </span>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">{code}</span>
            </div>
            <div className="font-display text-lg font-extrabold tracking-tight text-foreground">
              {system}
            </div>
            <div className="text-sm text-foreground/85">{bestFor}</div>
            <div className="text-sm text-muted-foreground">{handles}</div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{materials}</div>
            <ArrowUpRight className="h-5 w-5 justify-self-end text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
          </Link>
        ))}
      </div>

      {/* Mobile stacked spec cards */}
      <div className="mt-8 space-y-3 md:hidden">
        {SYSTEMS.map(({ code, icon: Icon, system, bestFor, handles, materials, href }) => (
          <Link
            key={code}
            to={href}
            className="group flex flex-col border border-foreground/15 bg-card p-5 transition hover:bg-muted/40"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center border border-foreground/20 bg-background" style={{ borderRadius: "2px" }}>
                  <Icon className="h-3.5 w-3.5 text-accent" />
                </span>
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">{code}</span>
              </div>
              <ArrowUpRight className="h-5 w-5 text-muted-foreground transition group-hover:text-accent" />
            </div>
            <h3 className="mt-3 font-display text-xl font-extrabold tracking-tight">{system}</h3>
            <div className="mt-3 space-y-1.5">
              <div className="spec-row"><span className="spec-label">Best For</span><span className="spec-value text-right">{bestFor}</span></div>
              <div className="spec-row"><span className="spec-label">Handles</span><span className="spec-value text-right">{handles}</span></div>
              <div className="spec-row"><span className="spec-label">Details</span><span className="spec-value text-right font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{materials}</span></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  </section>
);
