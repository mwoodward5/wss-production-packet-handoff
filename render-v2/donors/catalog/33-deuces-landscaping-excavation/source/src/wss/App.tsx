import {HomePage} from '@/routes/index';
import Excavation from '@/routes/excavation';
import Landscaping from '@/routes/landscaping';
import StormCleanup from '@/routes/storm-cleanup';
import Remodeling from '@/routes/remodeling';
import {CertifiedServicePage} from './CertifiedServicePage';
import {useEffect} from 'react';
import {bridge,WSS} from './bridge';
export function App({path=window.location.pathname}:{path?:string}){
 path=path.replace(/\/$/,'')||'/';
 useEffect(()=>{
  const bound=bridge.richService(path);
  document.title=bound ? bound.rich?.metaTitle || `${bound.service.name} | ${WSS.identity.businessName}` : WSS.identity.businessName;
  const description=document.querySelector('meta[name="description"]');
  description?.setAttribute('content',bound?.rich?.metaDescription || bound?.service.description || WSS.hero.support);
 },[path]);
 const pages:Record<string,()=>React.ReactNode>={'/':HomePage,'/excavation':Excavation,'/landscaping':Landscaping,'/storm-cleanup':StormCleanup,'/remodeling':Remodeling};
 const Page=pages[path.replace(/\/$/,'')||'/'];
 return Page ? <Page/> : <CertifiedServicePage path={path}/>;
}
