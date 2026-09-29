import { useLocation } from 'react-router-dom';
import { useClient, useSitePlan, serviceDetails, serviceImage, Copy } from './wss';

export function useServiceContent(){
  const c=useClient(), plan=useSitePlan(), location=useLocation();
  const service=c.services.find(s=>s.href===location.pathname);
  if(!service)throw new Error('service_route_unbound');
  const details=serviceDetails(plan,service);
  const body=details.body.filter(p=>p!==service.description);
  const props={
    seoTitle:service.name+' | '+c.identity.businessName,seoDesc:service.description,
    path:service.href,eyebrow:service.shortLabel,title:<>{service.name} <span className="copper-text">{c.identity.city}</span></>,
    intro:service.description,image:serviceImage(c,plan,service),imageAlt:'',serviceName:service.name,
    bodyLead:body[0] || '', body:<Copy text={body.slice(1).join('\n\n')}/>,bullets:details.bullets,
    related:c.services.filter(s=>s!==service).map(s=>({label:s.name,href:s.href})),
  };
  return {c,plan,service,details,props};
}
