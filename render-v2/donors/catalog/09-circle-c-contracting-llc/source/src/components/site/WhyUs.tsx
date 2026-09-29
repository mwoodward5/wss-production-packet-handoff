import { useClient } from "@/wss/bridge";
import { Handshake, Clock, Wrench, Tractor } from "lucide-react";



export function WhyUs() {
  const {client, plan} = useClient();
  const items = client.content.values.map(v => ({title:v.title, desc:v.body, icon:Handshake}));
  return (
    <section id="why" className="py-24 md:py-32 bg-background relative">
      <div className="container-tight">
        <div className="grid lg:grid-cols-12 gap-8 items-end mb-14">
          <div className="lg:col-span-7 reveal">
            <span className="eyebrow mb-5">About Us</span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-[3.5rem] font-bold uppercase leading-[0.98] text-balance mt-4">
              {client.content.whyHeadline || client.identity.businessName}
            </h2>
          </div>
          <p className="lg:col-span-5 text-muted-foreground text-lg leading-relaxed reveal reveal-delay-1">
            {plan?.content?.about || client.content.about}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <div
                key={it.title}
                className={`reveal reveal-delay-${i + 1} group relative flex gap-6 p-7 md:p-8 rounded-2xl bg-card border border-border shadow-card hover:shadow-deep hover:-translate-y-0.5 transition-all duration-500`}
              >
                <span className="absolute top-5 right-6 font-display text-muted-foreground/40 font-bold text-sm tracking-[0.25em]">
                  0{i + 1}
                </span>
                <div className="shrink-0 h-14 w-14 rounded-md bg-gradient-amber flex items-center justify-center text-accent-foreground shadow-glow-amber">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-xl md:text-2xl font-bold uppercase tracking-wide mb-2">
                    {it.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">{it.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}