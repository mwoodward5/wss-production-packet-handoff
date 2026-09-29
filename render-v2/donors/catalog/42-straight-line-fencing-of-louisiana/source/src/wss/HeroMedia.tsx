import { useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { site } from './bridge';
export function HeroMedia() {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  return <HeroMediaView reduced={!!reduced} failed={failed} onError={() => setFailed(true)} />;
}
export function HeroMediaView({ reduced, failed, onError }: { reduced: boolean; failed: boolean; onError: () => void }) {
  const style = { animation: reduced ? 'none' : 'slow-zoom 22s ease-out forwards', filter: 'brightness(0.78) contrast(1.08) saturate(1.05)' };
  return site.hero.video && !reduced && !failed ?
    <video src={site.hero.video} poster={site.hero.poster} autoPlay muted loop playsInline onError={onError} className="h-full w-full object-cover" style={style} aria-label="Project overview" /> :
    <img src={site.hero.poster} alt="Project overview" className="h-full w-full object-cover" style={style} />;
}
