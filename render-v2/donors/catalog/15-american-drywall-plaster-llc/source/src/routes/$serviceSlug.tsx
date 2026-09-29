import {createFileRoute} from '@tanstack/react-router';
import {client,trade} from '@/lib/bridge';
import {DrywallPage} from './drywall';
import {PlasterPage} from './plaster';
import {PaintingPage} from './painting';
import {pageMeta} from '@/lib/seo';
export const Route=createFileRoute('/$serviceSlug')({
 head:({params})=>{const s=client.services.find(s=>s.href==='/'+params.serviceSlug);return {meta:pageMeta({title:(s?.name||'Page not found')+' | '+client.identity.businessName,description:s?.description||'',path:'/'+params.serviceSlug})};},
 component:ServiceDetail
});
function ServiceDetail(){const {serviceSlug}=Route.useParams();const s=client.services.find(s=>s.href==='/'+serviceSlug);if(!s)return <div className="p-20 font-display text-4xl">Page not found</div>;const kind=trade(s.name);return kind==='drywall'?<DrywallPage selected={s}/>:kind==='plaster'?<PlasterPage selected={s}/>:kind==='painting'?<PaintingPage selected={s}/>:<section className="px-6 py-24 mx-auto max-w-[1400px]"><h1 className="font-display text-[44px] lg:text-[80px]">{s.name}</h1><p className="mt-6 text-[17px]">{s.description}</p></section>;}
