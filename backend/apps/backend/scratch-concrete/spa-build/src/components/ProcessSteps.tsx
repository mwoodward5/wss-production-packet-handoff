// The design's five-step process rail, claim-neutral: no response-time
// promises, no warranty assertions, no donor geography. Each step describes
// the WORK, not unverifiable promises about it.
const steps = [
  { n: "01", title: "Site Visit", body: "We come out, walk the project, measure, and listen to what the site needs." },
  { n: "02", title: "Written Quote", body: "Line-item pricing — concrete, prep, reinforcement, finish, and haul-off each spelled out." },
  { n: "03", title: "Permits & Prep", body: "We coordinate what the jurisdiction requires, then schedule the pour, formwork, and inspections." },
  { n: "04", title: "Pour & Finish", body: "Crews place, vibrate, and finish to the agreed spec — broom, smooth, salt, or stamped." },
  { n: "05", title: "Walkthrough", body: "A final walk of the finished work with you, and a clear point of contact afterward." },
];

export function ProcessSteps() {
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
