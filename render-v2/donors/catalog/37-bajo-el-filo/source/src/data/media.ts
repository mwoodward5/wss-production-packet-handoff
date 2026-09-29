import {getClient} from '@/wss/bridge';
export type MediaCategory = "gallery" | "people" | "about" | "hero" | "logo";
export type Orientation = "vertical" | "horizontal" | "square";
export type CornerMask = "tl" | "tr" | "bl" | "br" | "center";

export interface MediaItem {
  id: string;
  category: MediaCategory;
  kind: "video" | "image";
  src: string;
  poster?: string;
  w: number;
  h: number;
  orientation: Orientation;
  caption: string;
  permission: "approved" | "pending";
  /** Corners to blank-out (source has @playloscabos handle / IG glyph burned in) */
  maskCorners?: CornerMask[];
}


const c=getClient();
export const heroMontage={src:c.hero.video,poster:c.hero.poster};
export const media:MediaItem[]=c.media.filter(m=>m.role!=='logo'&&m.role!=='hero'&&/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(m.path)).sort((a,b)=>(a.rank??999)-(b.rank??999)).map((m,i)=>({id:m.path,category:m.role,kind:'image',src:m.path,w:m.width??1,h:m.height??1,orientation:m.width&&m.height?(m.width===m.height?'square':m.width<m.height?'vertical':'horizontal'):'horizontal',caption:'',permission:'approved'}));
export const verticalClips=()=>media.filter(m=>m.orientation==='vertical');
