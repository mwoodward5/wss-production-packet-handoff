import {client} from '@/wss/bridge';
import {Star} from 'lucide-react';
export function ProofTicker(){const a=client.trust.aggregate;if(!a||a.rating===null||a.count===null)return null;return <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm"><a href={a.sourceUrl} target="_blank" rel="noreferrer" className="chip-glass lift"><Star className="h-3.5 w-3.5 text-[color:var(--gold)]"/><span>{a.rating}★ · {a.count} reviews</span></a></div>}
