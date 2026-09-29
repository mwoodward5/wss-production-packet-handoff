import { Seo } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { MapPin } from "lucide-react";
import { useClient, useSitePlan, verifiedGeo } from "@/lib/wss";

const ServiceArea = () => {
const c=useClient(), plan=useSitePlan(), geo=verifiedGeo(plan);
return (
  <>
    <Seo title={"Service Area | " + c.identity.businessName} description={c.trust.areas.join(", ")} path="/service-area" />
    <PageHero eyebrow="Service Area" title={<>{c.identity.city}, <span className="copper-text italic">{c.identity.state}</span></>} intro={plan.content['service-area'] || c.trust.areas.join(" · ")} imageAlt="" />

    {geo && <section className="container py-12"><div className="rounded-2xl overflow-hidden ring-1 ring-border shadow-elevated">
      <iframe title={c.identity.businessName + ' location'} src={'https://www.google.com/maps?q='+geo.lat+','+geo.lng+'&output=embed'} width="100%" height="480" style={{border:0}} loading="lazy" referrerPolicy="no-referrer" allowFullScreen/>
    </div></section>}
    {c.trust.mapUrl && <section className="container py-12">
      <div className="rounded-2xl overflow-hidden ring-1 ring-border shadow-elevated p-8">
        <a href={c.trust.mapUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">View map and directions</a>
      </div>
    </section>}
    <section className="container py-12 grid gap-8 md:grid-cols-2">
      {c.trust.areas.map(area => (
        <div key={area} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-5 h-5 text-secondary" />
            <h2 className="font-display text-2xl">{area}</h2>
          </div>
        </div>
      ))}
    </section>
    <ContactClose />
  </>
);
};

export default ServiceArea;
