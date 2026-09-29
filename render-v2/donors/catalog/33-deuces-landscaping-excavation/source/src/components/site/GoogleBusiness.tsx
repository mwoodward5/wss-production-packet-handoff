import { WSS } from '@/wss/bridge';
export function GoogleMapEmbed(){return WSS.trust.mapUrl ? <div className="premium-card overflow-hidden min-h-72 flex items-center justify-center"><a className="btn-gold" href={WSS.trust.mapUrl} target="_blank" rel="noopener noreferrer">View location and directions</a></div> : null;}
