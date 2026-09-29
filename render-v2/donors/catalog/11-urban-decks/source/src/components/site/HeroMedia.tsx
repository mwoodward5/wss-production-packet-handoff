import {useEffect,useState} from 'react';
import {CLIENT} from '@/lib/wss';
export function useReducedMotion(){
 const [reduced,setReduced]=useState(true);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(q.matches);update();q.addEventListener('change',update);return ()=>q.removeEventListener('change',update);},[]);
 return reduced;
}
export function HeroMedia(){
 const reduced=useReducedMotion();const [failed,setFailed]=useState(false);
 const style='h-[112%] w-full object-cover slow-pan img-cinematic';
 if(CLIENT.hero.video&&!reduced&&!failed)return <video className={style} src={CLIENT.hero.video} poster={CLIENT.hero.poster} autoPlay muted loop playsInline onError={()=>setFailed(true)} aria-label={CLIENT.identity.businessName}/>;
 return <img src={CLIENT.hero.poster} alt={CLIENT.identity.businessName} className={style} width={1920} height={1280} fetchPriority="high"/>;
}
