import type {CSSProperties} from 'react';
import {getClient} from '@/wss/bridge';
export function BrandMark({size=36,className,style,title,onLight=false}: {size?:number;withSeal?:boolean;className?:string;style?:CSSProperties;title?:string;onLight?:boolean}){const c=getClient();return <img src={onLight?c.identity.logoOnLight:c.identity.logoOnDark} width={size} height={size} className={className} style={{objectFit:'contain',...style}} alt={title??c.identity.businessName}/>;}
