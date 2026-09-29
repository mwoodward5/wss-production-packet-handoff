import type {ImgHTMLAttributes} from 'react';
export function ClientImage(props:ImgHTMLAttributes<HTMLImageElement>) { return props.src?<img {...props}/>:null; }
