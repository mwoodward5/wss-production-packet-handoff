import {useEffect,useState} from 'react';
import {useSite} from '@/lib/wss';
export function HeroMedia(){
 const {client}=useSite();const [motion,setMotion]=useState(false);const [failed,setFailed]=useState(false);
 useEffect(()=>{const q=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setMotion(!q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update);},[]);
 return <><img src={client.hero.poster} alt={client.identity.businessName} width={1920} height={1280} fetchPriority="high" className="h-full w-full object-cover object-[center_40%] animate-[heroDrift_22s_ease-in-out_infinite_alternate] motion-reduce:animate-none"/>{motion && client.hero.video && !failed && <video className="absolute inset-0 h-full w-full object-cover object-[center_40%]" autoPlay muted loop playsInline poster={client.hero.poster} onError={()=>setFailed(true)} aria-hidden><source src={client.hero.video} type="video/mp4" onError={()=>setFailed(true)}/></video>}</>;
}
