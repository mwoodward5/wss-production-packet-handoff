import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Phone } from "lucide-react";
import { SERVICES, URGENCY_OPTIONS, BUSINESS } from "@/lib/business";

/**
 * Service Path Selector — the business-specific intelligence widget.
 *
 * Routes the visitor by:
 *  1. Job type
 *  2. Urgency / timeline
 *
 * Then surfaces the best next action: a curated service link + a tailored
 * recommendation. NOT FAKED — purely contextual routing.
 */
export function ServicePathSelector() {
  const [serviceSlug, setServiceSlug] = useState<string>(SERVICES[0].slug);
  const [urgencyId, setUrgencyId] = useState<string>("planned");

  const service = useMemo(
    () => SERVICES.find((s) => s.slug === serviceSlug) ?? SERVICES[0],
    [serviceSlug],
  );
  const urgency = useMemo(
    () => URGENCY_OPTIONS.find((u) => u.id === urgencyId) ?? URGENCY_OPTIONS[2],
    [urgencyId],
  );

  const recommendation = useMemo(() => urgency.id === 'emergency' ? {
    title: 'Call to discuss availability',
    body: 'Do not rely on this website for emergency response. Contact the company directly about your enquiry.',
    primary: { label: `Call ${BUSINESS.phone}`, href: BUSINESS.phoneHref, kind: 'phone' as const },
  } : {
    title: `Discuss ${service.name}`,
    body: 'Contact the company about your project, timing and any estimate requirements. Availability and pricing must be confirmed directly.',
    primary: { label: 'Start the conversation', href: '/contact', kind: 'link' as const },
  }, [service, urgency]);

  return (
    <section className="relative bg-background">
      <div className="mx-auto max-w-7xl px-5 py-20 md:px-8 md:py-28">
        <div className="grid gap-14 md:grid-cols-12">
          <header className="md:col-span-4">
            <div className="eyebrow">Service Path Selector</div>
            <h2 className="display mt-3 text-4xl md:text-5xl">
              Get to the right answer in two clicks.
            </h2>
            <p className="mt-4 text-foreground/75">
              Pick what you need, tell us when, and we'll point you at the right next step. No
              chatbots, no run-around.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" /> Routes your inquiry by
              type and urgency
            </div>
          </header>

          {/* WIDGET */}
          <div className="md:col-span-8">
            <div
              className="overflow-hidden rounded-3xl border border-border bg-card"
              style={{ boxShadow: "var(--shadow-couture)" }}
            >
              {/* Step 1 */}
              <div className="border-b border-border p-6 md:p-8">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[0.65rem] uppercase tracking-widest text-foreground/55">
                    01 · What do you need?
                  </div>
                  <div className="font-mono text-[0.65rem] uppercase tracking-widest text-[var(--gold)]">
                    {service.name}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SERVICES.map((s) => {
                    const active = s.slug === service.slug;
                    return (
                      <button
                        key={s.slug}
                        type="button"
                        onClick={() => setServiceSlug(s.slug)}
                        className={`group relative rounded-xl border p-4 text-left transition-all ${
                          active
                            ? "border-[var(--gold)] bg-[var(--ink)] text-[var(--bone)]"
                            : "border-border bg-background hover:border-foreground/40"
                        }`}
                      >
                        <div
                          className={`text-[0.7rem] font-mono uppercase tracking-widest ${
                            active ? "text-[var(--gold)]" : "text-foreground/50"
                          }`}
                        >
                          0{SERVICES.indexOf(s) + 1}
                        </div>
                        <div className="mt-1 text-sm font-semibold">{s.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2 */}
              <div className="border-b border-border p-6 md:p-8">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[0.65rem] uppercase tracking-widest text-foreground/55">
                    02 · When do you need it?
                  </div>
                  <div className="font-mono text-[0.65rem] uppercase tracking-widest text-[var(--gold)]">
                    {urgency.label}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {URGENCY_OPTIONS.map((u) => {
                    const active = u.id === urgency.id;
                    const accentClass =
                      u.accent === "red"
                        ? "before:bg-destructive"
                        : u.accent === "amber"
                          ? "before:bg-orange-500"
                          : u.accent === "gold"
                            ? "before:bg-[var(--gold)]"
                            : "before:bg-[var(--ink)]";
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => setUrgencyId(u.id)}
                        className={`relative overflow-hidden rounded-xl border p-4 pl-5 text-left transition-all before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${accentClass} ${
                          active
                            ? "border-foreground bg-secondary"
                            : "border-border bg-background hover:border-foreground/40"
                        }`}
                      >
                        <div className="text-sm font-semibold">{u.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{u.detail}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Result */}
              <div className="bg-[var(--ink)] p-6 text-[var(--bone)] md:p-8">
                <div className="font-mono text-[0.65rem] uppercase tracking-widest text-[var(--gold)]">
                  03 · Recommended next step
                </div>
                <h3 className="display mt-2 text-2xl md:text-3xl">{recommendation.title}</h3>
                <p className="mt-3 max-w-xl text-sm text-[var(--bone)]/75">{recommendation.body}</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {recommendation.primary.kind === "phone" ? (
                    <a
                      href={recommendation.primary.href}
                      className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-bold text-[var(--ink)]"
                    >
                      <Phone className="h-4 w-4" /> {recommendation.primary.label}
                    </a>
                  ) : (
                    <Link
                      to={recommendation.primary.href}
                      className="inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-3 text-sm font-bold text-[var(--ink)]"
                    >
                      {recommendation.primary.label} <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  <Link
                    to={service.href}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--bone)]/25 px-5 py-3 text-sm font-semibold text-[var(--bone)] hover:border-[var(--gold)] hover:text-[var(--gold)]"
                  >
                    See {service.name}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
