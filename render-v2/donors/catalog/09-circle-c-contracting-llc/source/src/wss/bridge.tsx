import {createContext, useContext} from 'react';
import type {Site} from './model';
export const SiteContext = createContext<Site | null>(null);
export function useClient() { const site = useContext(SiteContext); if (!site) throw Error('client_context_required'); return site; }
