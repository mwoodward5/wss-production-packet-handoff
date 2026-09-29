import {services} from "@/lib/wss";
/**
 * ServiceRouter
 * Interactive 3-step concierge widget that asks the visitor:
 *   1) What kind of project?
 *   2) When do you want to start?
 *   3) What's the rough budget?
 * …then routes them to the matching service detail page with the
 * /contact estimate form pre-filled via search params.
 *
 * Routes use TanStack <Link>/useNavigate (type-safe).
 * No PII is collected here — only project intent.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@/lib/navigation";





type Project = {key:string;label:string;hint:string;slug:string;formService:string};
const PROJECTS: Project[] = services.map(s=>({key:s.slug,label:s.title,hint:s.summary,slug:s.slug,formService:s.title}));

const TIMELINES = [
  "As soon as possible",
  "Within 1 month",
  "1–3 months",
  "3–6 months",
  "Just exploring",
] as const;

const BUDGETS = [
  "Under $5,000",
  "$5,000 – $15,000",
  "$15,000 – $50,000",
  "$50,000 – $150,000",
  "$150,000+",
  "Not sure yet",
] as const;

type Step = 1 | 2 | 3 | 4;

export function ServiceRouter() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);

  const progress = useMemo(() => {
    const filled = [project, timeline, budget].filter(Boolean).length;
    return Math.min(100, Math.round((filled / 3) * 100));
  }, [project, timeline, budget]);

  function reset() {
    setProject(null);
    setTimeline(null);
    setBudget(null);
    setStep(1);
  }

  function goToService() {
    if (!project) return;
    navigate({
      to: services.find(s=>s.slug===project.slug)!.href,
    });
  }

  function goToEstimate() {
    if (!project) return;
    navigate({
      to: "/contact",
      search: {
        service: project.formService,
        ...(timeline ? { timeline } : {}),
        ...(budget ? { budget } : {}),
      },
    });
  }

  return (
    <section
      aria-labelledby="service-router-heading"
      className="relative border-b border-ink/10 bg-ink text-cream"
    >
      {/* hairline accent */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cream/30 to-transparent" />

      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-12 lg:gap-12 lg:px-10 lg:py-16">
        {/* Left: pitch */}
        <div className="lg:col-span-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/60">
            Concierge · 30 seconds
          </p>
          <h2
            id="service-router-heading"
            className="mt-3 font-display text-3xl leading-tight lg:text-4xl"
          >
            Not sure where<br />to start?
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-cream/75">
            Answer three quick questions. We'll point you at the right service
            page and pre-fill your estimate request — no email required to
            browse.
          </p>

          {/* Progress */}
          <div className="mt-8">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60">
              <span>Step {Math.min(step, 3)} of 3</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-px w-full bg-cream/15">
              <div
                className="h-px bg-cream transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              <Chip active={!!project} label={project?.label ?? "Project"} />
              <Chip active={!!timeline} label={timeline ?? "Timeline"} />
              <Chip active={!!budget} label={budget ?? "Budget"} />
            </div>
          </div>
        </div>

        {/* Right: stepper */}
        <div className="lg:col-span-8">
          <div className="border border-cream/20 bg-cream/[0.04] p-6 backdrop-blur-sm lg:p-8">
            {/* Step 1: project */}
            {step === 1 && (
              <Panel
                eyebrow="Question 1 of 3"
                title="What are you thinking about building?"
              >
                <div className="grid gap-px bg-cream/15 sm:grid-cols-2 lg:grid-cols-3">
                  {PROJECTS.map((p) => {
                    const selected = project?.key === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => {
                          setProject(p);
                          setStep(2);
                        }}
                        className={`group flex flex-col items-start gap-1 bg-ink p-4 text-left transition-colors hover:bg-cream/10 ${
                          selected ? "ring-1 ring-inset ring-cream" : ""
                        }`}
                        aria-pressed={selected}
                      >
                        <span className="font-display text-base text-cream">
                          {p.label}
                        </span>
                        <span className="text-[11px] text-cream/60">
                          {p.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Step 2: timeline */}
            {step === 2 && (
              <Panel
                eyebrow="Question 2 of 3"
                title="When would you want to start?"
                onBack={() => setStep(1)}
              >
                <div className="grid gap-px bg-cream/15 sm:grid-cols-2 lg:grid-cols-5">
                  {TIMELINES.map((t) => {
                    const selected = timeline === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setTimeline(t);
                          setStep(3);
                        }}
                        className={`bg-ink p-4 text-left text-sm text-cream transition-colors hover:bg-cream/10 ${
                          selected ? "ring-1 ring-inset ring-cream" : ""
                        }`}
                        aria-pressed={selected}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Step 3: budget */}
            {step === 3 && (
              <Panel
                eyebrow="Question 3 of 3"
                title="Rough budget range?"
                onBack={() => setStep(2)}
              >
                <p className="mb-4 text-[12px] text-cream/60">These choices describe your preferences.</p>
                <div className="grid gap-px bg-cream/15 sm:grid-cols-2 lg:grid-cols-3">
                  {BUDGETS.map((b) => {
                    const selected = budget === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => {
                          setBudget(b);
                          setStep(4);
                        }}
                        className={`bg-ink p-4 text-left text-sm text-cream transition-colors hover:bg-cream/10 ${
                          selected ? "ring-1 ring-inset ring-cream" : ""
                        }`}
                        aria-pressed={selected}
                      >
                        {b}
                      </button>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Step 4: route */}
            {step === 4 && project && (
              <Panel
                eyebrow="Match found"
                title={`${project.label} · ${timeline ?? ""}`}
                onBack={() => setStep(3)}
              >
                <p className="text-sm leading-relaxed text-cream/80">Review your selected service or continue with your project details.</p>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={goToEstimate}
                    className="inline-flex items-center justify-center bg-cream px-6 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink transition-colors hover:bg-cream/90"
                  >
                    Request estimate →
                  </button>
                  <button
                    type="button"
                    onClick={goToService}
                    className="inline-flex items-center justify-center border border-cream/40 px-6 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream transition-colors hover:border-cream"
                  >
                    See {project.label.toLowerCase()} page
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex items-center justify-center px-2 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream/60 transition-colors hover:text-cream"
                  >
                    Start over
                  </button>
                </div>
              </Panel>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Panel({
  eyebrow,
  title,
  children,
  onBack,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/60">
          {eyebrow}
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60 underline-offset-4 hover:text-cream hover:underline"
          >
            ← Back
          </button>
        )}
      </div>
      <h3 className="mb-5 font-display text-xl text-cream lg:text-2xl">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`inline-flex max-w-[180px] items-center truncate border px-2.5 py-1 ${
        active
          ? "border-cream/60 bg-cream/10 text-cream"
          : "border-cream/20 text-cream/40"
      }`}
      title={label}
    >
      {label}
    </span>
  );
}
