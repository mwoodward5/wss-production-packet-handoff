import { WSS,mediaFor } from '@/wss/bridge';
const gallery=mediaFor('gallery').map(m=>({src:m.path,alt:`${WSS.identity.businessName} photo`,caption:''}));
export const MEDIA={logo:WSS.identity.logoOnLight,heroMotion:mediaFor('hero').slice(0,5).map(m=>({src:m.path,alt:''})),homeGallery:gallery.slice(0,12),gallery,founderBand:mediaFor('people')[0]?.path||'',aboutPortrait:mediaFor('people')[0]?.path||mediaFor('about')[0]?.path||'',service:gallery.slice(0,4)};
