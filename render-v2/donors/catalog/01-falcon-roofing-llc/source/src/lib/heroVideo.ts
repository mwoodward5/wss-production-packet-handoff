import {CLIENT} from './wss';
export const HERO_VIDEO_SOURCES=CLIENT.hero.video?[{src:CLIENT.hero.video,type:CLIENT.hero.video.endsWith('.webm')?'video/webm':'video/mp4'}]:[];
