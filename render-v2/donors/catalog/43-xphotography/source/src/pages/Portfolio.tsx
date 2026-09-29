import CinemaReel from '@/components/CinemaReel';
import Seo from '@/components/Seo';
import {frames,useSite} from '@/wss/bridge';
export default function Portfolio(){const {client}=useSite();const photos=frames();return <><Seo title={`Portfolio · ${client.identity.businessName}`} description={client.hero.support} path="/portfolio"/><section className="pt-44 pb-12 bg-paper"><div className="container"><div className="label-eyebrow text-molten mb-6">Portfolio</div><h1 className="font-display text-[9.6vw] md:text-[5.6vw] text-ivory">{client.identity.businessName}</h1></div></section>{photos.length>0&&<CinemaReel frames={photos} reelLabel="PORTFOLIO"/>}</>}
