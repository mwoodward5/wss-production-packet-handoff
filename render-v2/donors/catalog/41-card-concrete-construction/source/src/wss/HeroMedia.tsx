import {useEffect,useState} from 'react';
import type {Client} from './bridge';
export function HeroMedia({hero}:{hero:Client['hero']}){
 const [motion,setMotion]=useState(false);const [failed,setFailed]=useState(false);
 useEffect(()=>{const q=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setMotion(!q.matches);update();q.addEventListener('change',update);return()=>q.removeEventListener('change',update);},[]);
 return <><img src={hero.poster} alt="" width={1920} height={1280} fetchPriority="high" className="h-full w-full object-cover ken-burns"/>{hero.video && motion && !failed && <video src={hero.video} poster={hero.poster} autoPlay loop muted playsInline onError={()=>setFailed(true)} className="absolute inset-0 h-full w-full object-cover" aria-hidden="true"/>}</>;
}
