import { ServicePage } from "@/components/site/ServicePage";
import { useServiceContent } from "@/lib/service-content";
import { ShieldCheck } from "lucide-react";

const Residential = () => {
 const {c,service,details,props}=useServiceContent();
 return (
  <>
    <ServicePage {...props} />
    {details.gallery.length > 0 && <section className="container py-16">
      <div className="text-xs uppercase tracking-[0.22em] text-secondary mb-3">{service.shortLabel}</div>
      <h2 className="font-display text-3xl md:text-4xl">{service.name}</h2>
      <div className="mt-8 grid md:grid-cols-3 gap-4">
        {details.gallery.map(p => <div key={p.path} className="rounded-2xl overflow-hidden ring-1 ring-border shadow-elevated"><img src={p.path} alt={p.alt} className="w-full h-72 object-cover" loading="lazy" width={1200} height={800}/></div>)}
      </div>
    </section>}
  </>
);
};
export default Residential;
