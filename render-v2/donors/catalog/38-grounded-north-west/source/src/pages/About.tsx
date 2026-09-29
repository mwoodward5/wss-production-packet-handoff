import { useClient, useSitePlan, Copy, pageImage } from '@/lib/wss';
import { PageHero } from '@/components/site/PageHero';
import { Seo } from '@/components/site/Seo';
import { ContactClose } from '@/components/site/ContactClose';
export default function About(){const c=useClient(),plan=useSitePlan();return <>
  <Seo title={'About | '+c.identity.businessName} description={c.content.about} path="/about"/>
  <PageHero eyebrow="About" title={c.identity.businessName} intro={c.content.about} image={pageImage(c,'about')} imageAlt=""/>
  {plan.content.about && plan.content.about!==c.content.about && <section className="container py-16 max-w-3xl space-y-6"><Copy text={plan.content.about}/></section>}
  <ContactClose/>
</>;}
