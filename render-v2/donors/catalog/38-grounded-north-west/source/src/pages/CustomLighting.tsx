import { ServicePage } from "@/components/site/ServicePage";
import { useServiceContent } from "@/lib/service-content";
import { ShieldCheck } from "lucide-react";

const CustomLighting = () => {
 const {c,service,details,props}=useServiceContent();
 return (
  <>
    <ServicePage {...props} />

    {details.gallery.length > 0 && <section className="container py-16">
      <div className="text-xs uppercase tracking-[0.22em] text-secondary mb-3">{service.shortLabel}</div>
      <h2 className="font-display text-3xl md:text-4xl">{service.name}</h2>
      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-3">
        {details.gallery.map(p=><div key={p.path} className="rounded-xl overflow-hidden ring-1 ring-border shadow-sm"><img src={p.path} alt={p.alt} className="w-full h-56 object-cover" loading="lazy" width={1200} height={800}/></div>)}
      </div>
    </section>}
    {details.bullets.length > 0 && <section className="bg-muted/40 border-y border-border">
      <div className="container py-16">
        <div className="text-xs uppercase tracking-[0.22em] text-primary mb-3">{service.shortLabel}</div>
        <h2 className="font-display text-3xl md:text-4xl max-w-3xl">Service details</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {details.bullets.map((b,i)=><div key={i} className="rounded-xl border border-border bg-card p-5"><div className="font-display text-base mb-1">{b.title}</div><p className="text-sm text-muted-foreground">{b.body}</p></div>)}
        </div>
      </div>
    </section>}
  </>
);
};
export default CustomLighting;
