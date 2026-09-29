import { useEffect,useState } from 'react';
import { useSite } from './bridge';
export default function HeroMedia(){
 const {client}=useSite();const [reduce,setReduce]=useState(true);const [failed,setFailed]=useState(false);
 useEffect(()=>{const q=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduce(q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update);},[]);
 return <><img src={client.hero.poster} alt={client.identity.businessName} loading="eager" className="absolute inset-0 w-full h-full object-cover ken-burns" />{client.hero.video&&!reduce&&!failed&&<video src={client.hero.video} poster={client.hero.poster} autoPlay loop muted playsInline onError={()=>setFailed(true)} aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />}</>;
}
