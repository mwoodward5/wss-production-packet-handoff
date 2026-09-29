import type {AnchorHTMLAttributes} from 'react';
export function RouteLink({to,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&{to:string}){return <a href={to} {...props}/>}
