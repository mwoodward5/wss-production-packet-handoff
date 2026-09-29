import {useEffect, useState} from 'react';
import type {RefObject} from 'react';
import {useClient} from './bridge';
export function HeroMedia({imageRef}: {imageRef: RefObject<HTMLImageElement|null>}) {
  const {client} = useClient();
  const [reduce, setReduce] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const query = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduce(query.matches); update(); query.addEventListener('change',update); return () => query.removeEventListener('change',update); }, []);
  const style = {transform:'translate3d(0, var(--py, 0px), 0) scale(1.06)', objectPosition:'right center'};
  const className = 'absolute inset-0 h-[112%] w-full object-cover will-change-transform';
  return <><img ref={imageRef} src={client.hero.poster} alt="" width={1920} height={1280} fetchPriority="high" className={className} style={style} />
    {client.hero.video && !reduce && !failed && <video aria-hidden autoPlay muted loop playsInline poster={client.hero.poster} className={className} style={style} onError={() => setFailed(true)}><source src={client.hero.video} type="video/mp4" onError={() => setFailed(true)} /></video>}
  </>;
}
