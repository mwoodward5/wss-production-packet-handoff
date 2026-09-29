'use client'

import { client, sitePlan } from '@/lib/wssBridge'
import { useEffect, useState } from 'react'

export function About() {
  const [activeFrame, setActiveFrame] = useState(-1)
  const [animationStarted, setAnimationStarted] = useState(false)

  const steps=client.content.faqs.map((f,i)=>({number:String(i+1).padStart(2,'0'),title:f.q,description:f.a}))

  useEffect(() => {
    setTimeout(() => {
      setAnimationStarted(true)
      steps.forEach((_, i) => setTimeout(() => setActiveFrame(i), i * 2000 + 1000))
    }, 3000)
  }, [])

  return (
    <section id="about" className="relative py-24 bg-background overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background" />
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none">
        <div className="w-full h-full" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.8) 1px, transparent 0)',
          backgroundSize: '3px 3px',
          animation: 'filmGrain 8s infinite',
        }} />
      </div>

      <div className="container mx-auto px-6 sm:px-8 lg:px-12 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-3 h-3 bg-[#6B752E] rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">About & questions</span>
            <div className="w-3 h-3 bg-[var(--client-accent)] rounded-full animate-pulse" />
          </div>
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-6 text-foreground">
            About {client.identity.businessName}
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            {sitePlan?.content?.about || client.content.about}
          </p>
        </div>

        {steps.length > 0 && <div className="relative max-w-7xl mx-auto">
          <div className="relative bg-gradient-to-r from-[#1a1f17] via-[#22281c] to-[#1a1f17] rounded-xl overflow-hidden"
               style={{ boxShadow: '0 25px 50px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.05)' }}>
            <div className="absolute top-0 left-0 right-0 h-6 bg-black z-20 overflow-hidden">
              <div className={`flex items-center justify-between px-12 h-full ${animationStarted ? 'perforations-scroll-animation' : ''}`} style={{ width: '200%' }}>
                {[...Array(40)].map((_, i) => (
                  <div key={`top-${i}`} className="w-4 h-3 bg-gray-800 rounded-sm border border-gray-700 flex-shrink-0" />
                ))}
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-black z-20 overflow-hidden">
              <div className={`flex items-center justify-between px-12 h-full ${animationStarted ? 'perforations-scroll-animation' : ''}`} style={{ width: '200%' }}>
                {[...Array(40)].map((_, i) => (
                  <div key={`bot-${i}`} className="w-4 h-3 bg-gray-800 rounded-sm border border-gray-700 flex-shrink-0" />
                ))}
              </div>
            </div>

            <div className="relative py-6 px-8 overflow-x-auto min-h-64">
              <div className={`flex ${animationStarted ? 'film-scroll-animation' : ''}`} style={{ width: 'max-content', gap: '32px' }}>
                {[0, 1].map((dup) => (
                  <div key={dup} className="flex" style={{ gap: '32px' }}>
                    <div className="flex-shrink-0 w-80 h-52 bg-[#2a2f23] rounded-lg border-2 border-[#3a3f32] opacity-60 flex items-center justify-center">
                      <div className="text-[#cbb189] font-mono tracking-wider">● START</div>
                    </div>
                    {steps.map((s, i) => (
                      <div
                        key={`${dup}-${s.number}`}
                        className={`flex-shrink-0 w-80 min-h-52 bg-background rounded-lg border-4 ${activeFrame >= i ? 'border-[#6B752E]' : 'border-gray-600'}`}
                        style={{ boxShadow: '0 8px 16px rgba(0,0,0,0.3)' }}
                      >
                        <div className="relative h-full p-6 flex flex-col justify-between">
                          <div className="absolute -top-4 -left-4 w-12 h-12 bg-[#2A3E23] text-white rounded-full flex items-center justify-center font-black z-10 border-3 border-white text-lg" style={{ boxShadow: '0 6px 12px rgba(0,0,0,0.4)' }}>
                            {s.number}
                          </div>
                          <div>
                            <h3 className="font-black text-xl leading-tight mb-3 text-foreground">{s.title}</h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="flex-shrink-0 w-80 h-52 bg-[#2a2f23] rounded-lg border-2 border-[#3a3f32] opacity-60 flex items-center justify-center">
                      <div className="text-[#cbb189] font-mono tracking-wider">● FINISH</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        }
        {client.trust.badges.length > 0 && <div className="mt-12 text-center">
          <div className="inline-flex flex-wrap items-center justify-center gap-6 bg-card/80 backdrop-blur-sm clean-border rounded-2xl px-8 py-4 subtle-shadow">
            {client.trust.badges.map(b=><span key={b.label} className="text-sm font-semibold text-foreground">{b.label}</span>)}
          </div>
        </div>}
      </div>
    </section>
  )
}
