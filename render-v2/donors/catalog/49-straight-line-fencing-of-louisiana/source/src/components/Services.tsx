'use client'

import { useEffect, useState } from 'react'
import { client } from '@/lib/wssBridge'

export function Services() {
  const [isVisible, setIsVisible] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)

  const services = client.services.map((s,i)=>({id:String(i),title:s.name,description:s.description,href:s.href}))

  useEffect(() => {
    const t = setTimeout(() => setIsVisible(true), 300)
    return () => clearTimeout(t)
  }, [])

  return (
    <section id="services" className="relative py-24" style={{
      background: 'linear-gradient(135deg, #1a0f08 0%, #221608 30%, #160c06 60%, #221608 100%)',
      overflow: 'visible',
    }}>
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[var(--client-accent)]/15 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-[#6B752E]/15 rounded-full blur-2xl" />
      </div>

      <div className="container mx-auto px-6 sm:px-8 lg:px-12 relative z-10">
        <div className="text-center mb-16">
          <div className={`inline-flex items-center gap-3 mb-6 transition-all duration-1000 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
            <div className="w-3 h-3 bg-[#cbb189] rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-[#cbb189]/90 tracking-wider uppercase">What we build</span>
            <div className="w-3 h-3 bg-[#b9c468] rounded-full animate-pulse" />
          </div>
          <h2 className={`text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-6 text-[#f0e7d3] transition-all duration-1000 delay-200 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
            Services
          </h2>
          <p className={`text-xl text-[#cbb189]/90 leading-relaxed max-w-3xl mx-auto transition-all duration-1000 delay-400 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
            {client.content.serviceIntro}
          </p>
        </div>

        <div className={`relative max-w-7xl mx-auto transition-all duration-1000 delay-600 ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`} style={{ overflow: 'visible' }}>
          {Array.from({length:Math.ceil(services.length/3)},(_,i)=>i).map((row) => (
            <div key={row} className="relative mb-20" style={{ overflow: 'visible' }}>
              <div className="absolute top-8 left-0 right-0 h-3 rope-sway" style={{ animationDelay: `${row * 2}s` }}>
                <div className="w-full h-full bg-gradient-to-b from-[#8B6E3E] via-[#5e4a28] to-[#8B6E3E] rounded-full shadow-lg" />
                <div className="absolute -bottom-2 left-0 right-0 h-3 bg-black/30 rounded-full blur-lg" />
              </div>
              <div className="absolute left-0 sm:-left-6 top-4 w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-800 rounded-full shadow-xl border border-gray-400" />
              <div className="absolute right-0 sm:-right-6 top-4 w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-800 rounded-full shadow-xl border border-gray-400" />

              <div className="flex flex-wrap justify-center gap-6 lg:gap-16 pt-20 max-w-7xl mx-auto px-4">
                {services.slice(row * 3, row * 3 + 3).map((s, i) => (
                  <div
                    key={s.id}
                    className={`relative transform transition-all duration-700 ${hovered === s.id ? 'scale-105 -translate-y-2' : ''} ${i === 0 ? 'photo-sway-1' : i === 1 ? 'photo-sway-2' : 'photo-sway-3'}`}
                    onMouseEnter={() => setHovered(s.id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 z-20">
                      <div className="relative w-5 h-10">
                        <div className="absolute left-0 top-0 w-2.5 h-10 bg-gradient-to-r from-yellow-200 to-orange-300 rounded-l-md shadow-md" />
                        <div className="absolute right-0 top-0 w-2.5 h-10 bg-gradient-to-l from-yellow-200 to-orange-300 rounded-r-md shadow-md" />
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-4 h-2 bg-gradient-to-b from-gray-300 to-gray-500 rounded-sm" />
                      </div>
                    </div>
                    <div className="relative bg-white p-4 pb-6 shadow-2xl w-[260px] sm:w-[280px] max-w-[90vw]"
                         style={{ boxShadow: '0 20px 40px rgba(0,0,0,0.6), 0 8px 16px rgba(0,0,0,0.4)' }}>
                      <div className="h-48 mb-5 relative">
                        <div className="w-full h-full bg-[#f5efe2] flex items-center justify-center text-[#49331B] text-5xl font-mono" aria-hidden="true">{String(Number(s.id)+1).padStart(2, "0")}</div>
                      </div>
                      <h3 className="font-black text-lg text-gray-900 mb-2 leading-tight"><a href={s.href || "#contact"}>{s.title}</a></h3>
                      <p className="text-sm text-gray-700 leading-relaxed">{s.description}</p>
                      <div className="absolute bottom-2 right-3 text-[10px] text-gray-400 font-mono tracking-widest">{client.identity.city}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
