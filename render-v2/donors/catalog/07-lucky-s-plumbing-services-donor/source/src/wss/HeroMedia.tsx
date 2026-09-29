import { useEffect, useState } from 'react';
export default function HeroMedia({poster,video}: {poster:string;video:string}) {
  const [motion,setMotion] = useState(false);
  const [failed,setFailed] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(!preference.matches);
    update(); preference.addEventListener('change',update);
    return () => preference.removeEventListener('change',update);
  },[]);
  return <div aria-hidden className="absolute inset-0 opacity-[0.13] mix-blend-luminosity">
    <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover" />
    {video && motion && !failed && <video src={video} poster={poster} autoPlay muted loop playsInline onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />}
  </div>;
}
