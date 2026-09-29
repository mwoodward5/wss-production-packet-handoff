import { useEffect, useState, type CSSProperties } from 'react';
import { getClient } from '@/lib/wss-client';
export function HeroMedia({ className, style }: { className: string; style?: CSSProperties }) {
  const { hero } = getClient();
  const [reduce, setReduce] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <div data-wss-hero-media>
    <img src={hero.poster} alt="" aria-hidden="true" fetchPriority="high" decoding="async" className={className} style={style} />
    {hero.video && !reduce && !failed && <video src={hero.video} poster={hero.poster}
      autoPlay muted loop playsInline preload="metadata" aria-hidden="true"
      tabIndex={-1} disableRemotePlayback className={className} style={style}
      onError={() => setFailed(true)} />}
  </div>;
}
