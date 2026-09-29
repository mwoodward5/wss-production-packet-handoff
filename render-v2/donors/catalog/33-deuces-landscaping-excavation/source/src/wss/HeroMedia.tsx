import {useEffect,useState} from 'react';
import {WSS} from './bridge';
export function HeroMedia(){
 const [reduce,setReduce]=useState(true);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduce(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 const classes='absolute inset-0 w-full h-full object-cover object-center';
 return <><img src={WSS.hero.poster} alt="" aria-hidden="true" fetchPriority="high" className={classes+' motion-safe:animate-ken-burns'}/>{WSS.hero.video&&!reduce&&!failed&&<video className={classes} src={WSS.hero.video} poster={WSS.hero.poster} autoPlay muted loop playsInline aria-hidden="true" onError={()=>setFailed(true)}/>}</>;
}
