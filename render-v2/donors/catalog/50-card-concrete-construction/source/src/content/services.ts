import { BINDING } from '@/lib/site';
export type Service = {slug: string; href: string; name: string; blurb: string; details: string; ideal: string; icon: 'screed' | 'slab' | 'flat' | 'stamp' | 'demo-interior' | 'demo-wall' | 'demo-structure'};
export const SERVICES: Service[] = BINDING.services;
