import { getSite, hoursText, sectionCopy } from "@/lib/wss";

export function About() {
  const c=getSite();
  const texture=c.media.find(m=>m.role==="about");
  return (
    <section id="about" className="relative py-24 sm:py-32 bg-foreground text-background overflow-hidden">
      <div className="absolute inset-0">
        {texture && <img src={texture.path} alt="" aria-hidden className="h-full w-full object-cover opacity-20" />}
        <div className="absolute inset-0 bg-foreground/85" />
      </div>
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 grid grid-cols-12 gap-8 items-center">
        <div className="col-span-12 lg:col-span-7">
          <span className="text-xs tracking-[0.3em] uppercase text-background/60">§ 05 — About the shop</span>
          <h2 className="mt-4 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] tracking-tight text-balance">
            {c.content.whyHeadline || c.identity.businessName}
          </h2>
          <div className="mt-7 space-y-5 text-background/80 text-base sm:text-lg leading-relaxed text-pretty max-w-2xl">
            {sectionCopy('about',c.content.about).split(/\n\n+/).map((p,i)=><p key={i}>{p}</p>)}
          </div>
          {c.content.values.length > 0 && <dl className="mt-7 space-y-5 text-background/80">{c.content.values.map((v,i)=><div key={i}><dt className="font-display text-xl">{v.title}</dt><dd className="mt-2 leading-relaxed">{v.body}</dd></div>)}</dl>}
        </div>

        <aside className="col-span-12 lg:col-span-4 lg:col-start-9">
          <div className="grid grid-cols-2 gap-3">
            {[
              {k:"City",v:c.identity.city+", "+c.identity.state},
              {k:"Phone",v:c.identity.phoneDisplay},
              ...(hoursText() ? [{k:"Hours",v:hoursText()}] : []),
              ...(c.identity.founded ? [{k:"Founded",v:String(c.identity.founded)}] : []),
            ].map((r) => (
              <div key={r.k} className="rounded-xl border border-background/15 bg-background/5 p-4">
                <div className="text-[10px] tracking-[0.28em] uppercase text-background/50">{r.k}</div>
                <div className="mt-1 font-display text-lg">{r.v}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
