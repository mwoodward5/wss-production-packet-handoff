import { Star } from 'lucide-react';
import { useClient } from '@/lib/wss';
export const GoogleReviewButton = ({className=''}:{className?:string}) => {
  const c=useClient(); const url=c.trust.aggregate?.sourceUrl || c.trust.reviews[0]?.sourceUrl;
  if(!url)return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center justify-center gap-2 rounded-full bg-gradient-trust text-primary-foreground px-6 py-3 text-sm font-semibold shadow-glow hover:scale-[1.02] transition-transform ${className}`}><Star className="w-4 h-4 fill-current"/> Read reviews</a>;
};
// The contract supplies badge text, not verified seal images or issuer links.
export const BbbSeal = () => null;
export const GeneracDealerBadge = ({className=''}:{className?:string}) => {
  const c=useClient();
  return <>{c.trust.badges.map((b,i)=><div key={i} className={`text-xs text-foreground font-medium ${className}`}><span>{b.label}</span>{b.sublabel && <p>{b.sublabel}</p>}{b.meta && <p>{b.meta}</p>}</div>)}</>;
};
