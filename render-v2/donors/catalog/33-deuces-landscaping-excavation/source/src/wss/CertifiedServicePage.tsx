import {CertifiedMarkdown} from './CertifiedMarkdown';
import {bridge,WSS} from './bridge';
import {ServicePageLayout} from '@/components/site/ServicePage';
import {SiteLayout} from '@/components/site/Layout';
import {Section, FAQ} from '@/components/site/Sections';
export function CertifiedServicePage({path}:{path:string}){
 const bound=bridge.richService(path);
 if(!bound) return <SiteLayout><Section><h1 className="text-4xl font-display">Service unavailable</h1><a href="/">Return home</a></Section></SiteLayout>;
 const {service,rich}=bound;
 const markdown=rich?.longDescMd && !/^content\//.test(rich.longDescMd) ? rich.longDescMd : '';
 const faqs=rich?.faqs?.filter(f=>typeof f.q==='string'&&typeof f.a==='string') || [];
 return <ServicePageLayout slug={path.slice(1)} pageTitle={service.name} metaTitle={rich?.metaTitle||service.name} metaDescription={rich?.metaDescription||service.description}
 hero={{eyebrow:WSS.hero.eyebrow,headline:rich?.h1||service.name,sub:rich?.shortDesc||service.description}}
 longContent={markdown ? <CertifiedMarkdown>{markdown}</CertifiedMarkdown> : undefined}
 intro={<><p>{service.description}</p>{faqs.length>0&&<div className="mt-8"><FAQ items={faqs}/></div>}</>}
 scope={[]} process={[]} protectedTerms={WSS.services.map(s=>s.name)} related={WSS.services.filter(s=>s.href&&s.href!==path).map(s=>({to:s.href,label:s.shortLabel}))}
 defaultService={service.name} />;
}
