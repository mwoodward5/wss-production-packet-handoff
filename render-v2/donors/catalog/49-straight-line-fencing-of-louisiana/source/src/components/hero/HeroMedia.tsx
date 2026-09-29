import { useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { client } from '@/lib/wssBridge'
export function HeroMedia() {
 const reduced=useReducedMotion(); const [failed,setFailed]=useState(false)
 return <>
  <img src={client.hero.poster} alt={client.identity.businessName} className="absolute inset-0 w-full h-full object-cover" style={{filter:'brightness(0.78) saturate(1.1) contrast(1.05)'}} />
  {client.hero.video && reduced === false && !failed && <video src={client.hero.video} poster={client.hero.poster} muted autoPlay loop playsInline onError={()=>setFailed(true)} className="absolute inset-0 w-full h-full object-cover" style={{filter:'brightness(0.78) saturate(1.1) contrast(1.05)'}} />}
 </>
}
