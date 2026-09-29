import { Hero } from "@/components/site/Hero";
import { ServiceCards } from "@/components/site/ServiceCards";
import { ContactClose } from "@/components/site/ContactClose";
import { Seo, localBusinessSchema } from "@/components/site/Seo";
import { motion } from "framer-motion";
import { CheckCircle2, Compass, ShieldCheck, Sparkles, MapPin } from "lucide-react";
import { useClient, useSitePlan, paragraphs, Copy } from "@/lib/wss";

const Index = () => {
const c=useClient(); const process=c.content.values.map(v=>({...v,icon:Compass})); const counties=c.trust.areas;
const plan=useSitePlan();
const extra=paragraphs(plan.content.home).filter(p=>!p.startsWith('#') && ![c.hero.support,c.content.serviceIntro,c.content.about,...c.services.map(s=>s.description)].includes(p)).join('\n\n');
return (
  <>
    <Seo title={c.identity.businessName} description={c.hero.support} path="/" />
    <Hero />
    <ServiceCards />

    <section className="container py-20">
      <div className="grid lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-4">
          <div className="text-xs uppercase tracking-[0.22em] text-secondary mb-3 font-medium">About us</div>
          <h2 className="font-display text-4xl md:text-5xl leading-tight">{c.content.whyHeadline || c.identity.businessName}</h2>
          <p className="mt-5 text-muted-foreground">{c.content.about}</p>
          <p className="mt-6 italic text-foreground">{c.content.seasonalNote}</p>
          {extra && <div className="mt-6 space-y-5 text-muted-foreground"><Copy text={extra}/></div>}
        </div>
        <div className="lg:col-span-8 grid sm:grid-cols-2 gap-4">
          {process.map((p, i) => (
            <motion.div key={p.title}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="w-11 h-11 rounded-xl bg-primary grid place-items-center text-primary-foreground mb-4">
                <p.icon className="w-5 h-5" />
              </div>
              <div className="font-display text-xl mb-1">{p.title}</div>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>

    {counties.length > 0 && <section className="bg-primary text-primary-foreground">
      <div className="container py-16 grid md:grid-cols-12 gap-8 items-center">
        <div className="md:col-span-5">
          <div className="text-xs uppercase tracking-[0.22em] text-primary-foreground/70 mb-3 font-medium">Service Area</div>
          <h2 className="font-display text-3xl md:text-4xl leading-tight">{c.identity.city}, {c.identity.state}</h2>
        </div>
        <div className="md:col-span-7 grid sm:grid-cols-2 gap-3">
          {counties.map(c => (
            <div key={c} className="flex items-center gap-3 rounded-xl bg-primary-foreground/10 border border-primary-foreground/20 px-4 py-3">
              <MapPin className="w-4 h-4 text-secondary" />
              <span className="text-sm font-medium">{c}</span>
            </div>
          ))}
        </div>
      </div>
    </section>}

    <ContactClose />
  </>
);
};

export default Index;
