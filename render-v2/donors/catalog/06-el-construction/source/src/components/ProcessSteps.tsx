// The copied contract has no certified ordered process field.
const steps: {n:string;title:string;body:string}[]=[];

export function ProcessSteps() {
  if (!steps.length) return null;
  return (
    <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      {steps.map((s) => (
        <li key={s.n} className="relative rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-1 hover:shadow-elegant">
          <div className="font-display text-3xl font-bold text-gold">{s.n}</div>
          <h3 className="mt-2 font-display text-lg font-semibold">{s.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
