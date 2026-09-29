import { Seo, Breadcrumbs, localBusinessSchema } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { Link } from "react-router-dom";
import { ShieldCheck, Gauge, Wrench, AlertTriangle, Zap, Plug, Check, Phone } from "lucide-react";
import { GeneracDealerBadge } from "@/components/site/ReviewsTrust";

import { useServiceContent } from "@/lib/service-content";

const WholeHomeGenerators = () => {
 const {c,service,details,props}=useServiceContent();
 const badges=c.trust.badges.filter(b=>/generator|generac/i.test(b.label));
 return (
  <>
    <Seo title={props.seoTitle} description={props.seoDesc} path={props.path}/>
    <PageHero eyebrow={props.eyebrow} title={props.title} intro={props.intro} image={props.image} imageAlt={props.imageAlt}/>
    <div className="container pt-6"><Breadcrumbs items={[{name:"Home",href:"/"},{name:service.name,href:service.href}]}/></div>
    {/* AUTHORIZED DEALER STRIP */}
    {badges.length > 0 && <section className="bg-primary text-primary-foreground">
      <div className="container py-10 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-5">

          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-primary-foreground/70">Credentials</div>
            <div className="font-display text-2xl md:text-3xl">{badges[0]?.label}</div>
            <p className="text-sm text-primary-foreground/80 mt-1">{badges[0]?.sublabel}</p>
          </div>
        </div>
        <a href={c.identity.phoneTel} className="inline-flex items-center gap-2 rounded-full bg-secondary text-secondary-foreground px-6 py-3 text-sm font-semibold shadow-glow hover:scale-[1.02] transition-transform shrink-0">
          <Phone className="w-4 h-4" /> {c.identity.phoneDisplay}
        </a>
      </div>
    </section>}

    {/* INTRO */}
    <section className="container py-16 grid lg:grid-cols-12 gap-12">
      <div className="lg:col-span-7 space-y-6">
        <h2 className="font-display text-3xl md:text-4xl">{service.name}</h2>
        {details.body.filter(p=>p!==service.description).map((p,i)=><p key={i} className="text-lg leading-relaxed text-muted-foreground">{p}</p>)}
      </div>
      <aside className="lg:col-span-5 space-y-4">
        <div className="rounded-2xl border border-border bg-gradient-card p-6">
          {details.bullets.length > 0 && <div className="text-xs uppercase tracking-[0.22em] text-primary mb-4">Service details</div>}
          <ul className="space-y-3">
            {details.bullets.map(b => (
              <li key={b.title} className="flex gap-3">
                <Check className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{b.title}</div>
                  <div className="text-sm text-muted-foreground">{b.body}</div>
                </div>
              </li>
            ))}
          </ul>
          <a href={c.identity.phoneTel} className="mt-6 inline-flex items-center justify-center gap-2 w-full rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold shadow-glow hover:scale-[1.01] transition-transform">
            <Phone className="w-4 h-4" /> Call {c.identity.phoneDisplay}
          </a>
        </div>
      </aside>
    </section>

    {/* PHOTO GALLERY */}
    {details.gallery.length > 0 && <section className="bg-muted/40 border-y border-border">
      <div className="container py-16">
        <div className="text-xs uppercase tracking-[0.22em] text-secondary mb-3">Gallery</div>
        <h2 className="font-display text-3xl md:text-4xl">{service.name}</h2>
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          {details.gallery.slice(0,4).map((p,i)=><div key={p.path} className={`rounded-2xl overflow-hidden ring-1 ring-border shadow-elevated ${i===0 || i===3 ? 'md:col-span-2' : ''}`}>
            <img src={p.path} alt={p.alt} className={`w-full ${i<2?'h-80':'h-72'} object-cover`} loading="lazy" width={1200} height={800}/>
          </div>)}
        </div>
      </div>
    </section>}

    {/* CAPABILITIES GRID */}
    {details.bullets.length > 0 && <section className="container py-20">
      <div className="grid lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4">
          <div className="text-xs uppercase tracking-[0.22em] text-primary mb-3">{service.shortLabel}</div>
          <h2 className="font-display text-3xl md:text-4xl leading-[1.05]">Service details</h2>
        </div>
        <div className="lg:col-span-8 grid sm:grid-cols-2 gap-4">
          {details.bullets.map(f => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5">
              <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground grid place-items-center mb-3">
                <Plug className="w-5 h-5" />
              </div>
              <div className="font-display text-lg mb-1">{f.title}</div>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>}

    {/* WHY CHOOSE */}
    {badges.length > 1 && <section className="bg-muted/40 border-y border-border">
      <div className="container py-16">
        <div className="text-xs uppercase tracking-[0.22em] text-primary mb-3 text-center">Credentials</div>
        <h2 className="font-display text-3xl md:text-4xl text-center max-w-3xl mx-auto">{badges[1]?.label}</h2>
        <p className="mt-4 max-w-2xl mx-auto text-center text-muted-foreground">
          {badges[1]?.sublabel}
        </p>
        <div className="mt-10 text-center">
          <a href={c.identity.phoneTel} className="inline-flex items-center gap-2 rounded-full bg-secondary text-secondary-foreground px-7 py-3.5 text-sm font-semibold shadow-glow hover:scale-[1.02] transition-transform">
            <Phone className="w-4 h-4" /> Call {c.identity.phoneDisplay}
          </a>
        </div>
      </div>
    </section>}

    <ContactClose  />
  </>
);
};

export default WholeHomeGenerators;
