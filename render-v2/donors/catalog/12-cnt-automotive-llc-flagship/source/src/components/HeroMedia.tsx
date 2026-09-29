import { useEffect, useState } from 'react';
export default function HeroMedia({ poster, video }: { poster: string; video: string }) {
  const [reduced, setReduced] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return video && !reduced && !failed
    ? <video src={video} poster={poster} autoPlay loop muted playsInline onError={() => setFailed(true)} className="w-full h-full object-cover opacity-70" aria-hidden="true" />
    : <img src={poster} alt="" className="w-full h-full object-cover opacity-70" width={1600} height={900} {...{ fetchpriority: 'high' }} decoding="async" />;
}
