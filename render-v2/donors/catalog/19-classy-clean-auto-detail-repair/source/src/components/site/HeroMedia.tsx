import { useEffect, useState } from 'react';
import { getSite } from '@/lib/wss';
export function HeroMedia() {
  const {hero,identity}=getSite();
  const [reduce,setReduce]=useState(true);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{const q=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduce(q.matches);update();q.addEventListener('change',update);return ()=>q.removeEventListener('change',update)},[]);
  const crop='h-full w-full object-cover object-[60%_55%] scale-[1.04]';
  return <><img src={hero.poster} alt={identity.businessName} width={1920} height={1080} fetchPriority="high" className={crop+' motion-safe:animate-[heroDrift_38s_ease-in-out_infinite_alternate]'} />
    {hero.video && !reduce && !failed && <video className={'absolute inset-0 '+crop} src={hero.video} poster={hero.poster} muted autoPlay loop playsInline preload="metadata" onError={()=>setFailed(true)} aria-hidden />}</>;
}
