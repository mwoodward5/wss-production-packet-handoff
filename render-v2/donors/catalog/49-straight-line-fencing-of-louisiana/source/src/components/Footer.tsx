'use client'

import { Facebook, Phone, Mail, MapPin, Clock } from 'lucide-react'
import { client } from '@/lib/wssBridge'
import { SLF, logoImg } from '@/lib/slfAssets'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="relative py-16 bg-[#1a1f17] text-[#e9e2d0]">
      <div className="container mx-auto px-6 sm:px-8 lg:px-12">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-12 md:col-span-5">
            <div className="flex items-center gap-3 mb-5">
              <img src={logoImg} alt={SLF.name + " logo"} className="h-12 w-12 rounded-md object-cover" />
              <div>
                <div className="font-black text-xl leading-tight">{SLF.name}</div>
                <div className="text-xs tracking-[0.2em] text-[#cbb189]">{SLF.city}</div>
              </div>
            </div>
            <p className="text-[#cbb189]/90 leading-relaxed mb-5 max-w-md">
              {client.trust.areas.join(" · ")}
            </p>
            {SLF.facebook && <a href={SLF.facebook} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-2 text-[#cbb189] hover:text-white gentle-animation">
              <Facebook className="w-4 h-4" /> Facebook
            </a>}
          </div>

          <div className="col-span-12 md:col-span-4 space-y-3">
            <h4 className="font-black text-lg text-white mb-3">Contact</h4>
            <a href={SLF.phoneHref} className="flex items-center gap-3 hover:text-white gentle-animation">
              <Phone className="w-4 h-4 text-[#cbb189]" /> {SLF.phone}
            </a>
            {SLF.email && <a href={`mailto:${SLF.email}`} className="flex items-center gap-3 hover:text-white gentle-animation break-all">
              <Mail className="w-4 h-4 text-[#cbb189]" /> {SLF.email}
            </a>}
            {SLF.googleMaps && <a href={SLF.googleMaps} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:text-white gentle-animation">
              <MapPin className="w-4 h-4 text-[#cbb189]" /> {SLF.city} · Open in Google Maps
            </a>}
            {SLF.hours && <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-[#cbb189]" /> {SLF.hours}
            </div>}
          </div>

          <div className="col-span-12 md:col-span-3">
            <h4 className="font-black text-lg text-white mb-3">Services</h4>
            <ul className="space-y-2 text-[#cbb189]/90">
              {client.services.map(s=><li key={s.name}><a href={s.href || "/#services"} className="hover:text-white gentle-animation">{s.name}</a></li>)}
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 mt-12 flex flex-col md:flex-row justify-between gap-3 text-sm text-[#cbb189]/80">
          <div>© {year} {SLF.name}. All rights reserved.</div>
          <div>{SLF.city} · {SLF.phone}</div>
        </div>
      </div>
    </footer>
  )
}
