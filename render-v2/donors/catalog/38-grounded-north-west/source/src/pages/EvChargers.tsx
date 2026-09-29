import { Seo, Breadcrumbs, localBusinessSchema } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { Link } from "react-router-dom";
import { BatteryCharging, Gauge, ShieldCheck, Clock, Home, Building2, Check, Phone } from "lucide-react";

import { useServiceContent } from "@/lib/service-content";

const EvChargers = () => {
 const {c,service,details,props}=useServiceContent();
 const brands: {name:string;src:string}[]=[];
 const installImg=details.gallery[0];
 return (
  <>
    <Seo title={props.seoTitle} description={props.seoDesc} path={props.path} />
    <PageHero eyebrow={props.eyebrow} title={props.title} intro={props.intro} image={props.image} imageAlt={props.imageAlt}/>
    <div className="container pt-6"><Breadcrumbs items={[{name:"Home",href:"/"},{name:service.name,href:service.href}]}/></div>
    {/* INTRO + KEY POINTS */}
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

    {/* SUPPORTED BRANDS */}
    {brands.length > 0 && <section className="bg-muted/40 border-y border-border">
      <div className="container py-16">
        <div className="text-center mb-10">
          <div className="text-xs uppercase tracking-[0.28em] text-secondary mb-3">Supported brands</div>
          <h2 className="font-display text-3xl md:text-4xl">{service.name}</h2>
          <p className="mt-4 max-w-2xl mx-auto text-muted-foreground"></p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 items-center">
          {brands.map(b => (
            <div key={b.name} className="rounded-xl border border-border bg-background p-5 h-24 grid place-items-center">
              <img src={b.src} alt={b.name} className="max-h-12 max-w-full object-contain" loading="lazy" />
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground"></p>
      </div>
    </section>}

    {/* INSTALL DETAIL + IMAGE */}
    {installImg && <section className="container py-20 grid lg:grid-cols-12 gap-12 items-center">
      <div className="lg:col-span-6">
        <div className="rounded-2xl overflow-hidden ring-1 ring-border shadow-elevated">
          <img src={installImg.path} alt={installImg.alt} className="w-full h-[460px] object-cover" loading="lazy" width={1200} height={900} />
        </div>
      </div>
      <div className="lg:col-span-6">
        <h2 className="font-display text-3xl md:text-4xl leading-[1.05]">{service.name}</h2>
        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          {details.bullets.map(f => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5">
              <div className="w-10 h-10 rounded-lg bg-primary text-primary-foreground grid place-items-center mb-3">
                <Check className="w-5 h-5" />
              </div>
              <div className="font-display text-base mb-1">{f.title}</div>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>}

    {/* WHY CHOOSE */}
    {c.trust.badges.length > 0 && <section className="bg-muted/40 border-y border-border">
      <div className="container py-16">
        <div className="text-xs uppercase tracking-[0.22em] text-primary mb-3 text-center">Credentials</div>
        <h2 className="font-display text-3xl md:text-4xl text-center max-w-3xl mx-auto">{c.identity.businessName}</h2>
        <div className="mt-10 grid md:grid-cols-3 gap-6">
          {c.trust.badges.map(c => (
            <div key={c.label} className="rounded-2xl border border-border bg-card p-6">
              <ShieldCheck className="w-7 h-7 text-primary mb-3" />
              <div className="font-display text-xl mb-2">{c.label}</div>
              <p className="text-sm text-muted-foreground leading-relaxed">{c.sublabel}</p>
            </div>
          ))}
        </div>
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

export default EvChargers;
