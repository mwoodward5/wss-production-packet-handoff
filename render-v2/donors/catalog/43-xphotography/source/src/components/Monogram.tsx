import {useSite} from '@/wss/bridge';
interface Props {size?:number;className?:string;withWordmark?:boolean;animated?:boolean}
export default function Monogram({size=64,className='',withWordmark=false}:Props){
 const {client}=useSite();
 return <div className={`inline-flex items-center gap-3 ${className}`}><img src={client.identity.logoOnLight} alt={client.identity.businessName} width={size} height={size} className="object-contain" style={{width:size,height:size}} />{withWordmark&&<div className="leading-none"><div className="font-display text-[1.6rem] md:text-[1.85rem] tracking-tight">{client.identity.businessName}</div><div className="label-eyebrow text-[0.55rem] mt-1.5 opacity-60 tracking-[0.35em]">{client.identity.city} · {client.identity.state}</div></div>}</div>;
}
