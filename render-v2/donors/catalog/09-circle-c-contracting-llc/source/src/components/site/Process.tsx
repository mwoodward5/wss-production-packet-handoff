const steps: {n:string; title:string; desc:string}[] = [];

export function Process() {
  if (!steps.length) return null;
  return (
    <section
      id="process"
      className="relative py-24 md:py-32 bg-gradient-ink text-primary-foreground overflow-hidden"
    >
      {/* subtle grid texture */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      <div className="container-tight relative">
        <div className="grid lg:grid-cols-12 gap-8 items-end mb-16">
          <div className="lg:col-span-7 reveal">
            <span className="eyebrow mb-5" style={{ color: "var(--accent)" }}>How It Works</span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-[3.5rem] font-bold uppercase leading-[0.98] text-balance mt-4">
              Project
              <span className="text-accent"> process.</span>
            </h2>
          </div>
          <p className="lg:col-span-5 text-primary-foreground/75 text-lg leading-relaxed reveal reveal-delay-1">
            
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px rounded-2xl overflow-hidden bg-primary-foreground/10 border border-primary-foreground/10">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={`reveal reveal-delay-${i + 1} relative p-8 bg-primary/80 hover:bg-primary/60 transition-colors duration-500`}
            >
              <div className="flex items-baseline justify-between mb-5">
                <div className="font-display text-6xl font-bold text-accent leading-none">{s.n}</div>
                <div className="h-px flex-1 ml-5 bg-primary-foreground/15" />
              </div>
              <h3 className="font-display text-xl font-bold uppercase tracking-wide mb-3">{s.title}</h3>
              <p className="text-primary-foreground/70 leading-relaxed text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}