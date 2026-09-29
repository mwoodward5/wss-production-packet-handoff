import { Seo } from "@/components/site/Seo";
import { ServiceCards } from "@/components/site/ServiceCards";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { useClient } from "@/lib/wss";

const Services = () => {
const c=useClient();
return (
  <>
    <Seo title={"Services | " + c.identity.businessName} description={c.content.serviceIntro} path="/services" />
    <PageHero eyebrow="Services" title={<>{c.identity.businessName} <span className="copper-text italic">services</span></>} intro={c.content.serviceIntro} imageAlt="" />
    <ServiceCards />
    <ContactClose />
  </>
);
};

export default Services;
