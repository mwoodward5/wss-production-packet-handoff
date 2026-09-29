const steps: {n:string;t:string;d:string}[] = [];
// No typed certified process-step field exists in the copied contract.

export function Process() {
  if (!steps.length) return null;
  return (
    <section id="process" className="relative py-24 md:py-32 bg-gradient-ink text-white overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="relative container mx-auto px-5 md:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.25em] uppercase text-[var(--gold)]">
            How we work
          </p>
          <h2 className="mt-3 text-3xl md:text-5xl uppercase leading-[1.05]">
            Our process.
          </h2>
        </div>

        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative rounded-sm border border-white/10 bg-white/[0.03] backdrop-blur p-6 hover:bg-white/[0.06] transition"
            >
              <div className="text-5xl font-display text-gradient-warm leading-none">{s.n}</div>
              <h3 className="mt-5 text-base uppercase">{s.t}</h3>
              <p className="mt-2 text-sm text-white/70 leading-relaxed font-sans">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
