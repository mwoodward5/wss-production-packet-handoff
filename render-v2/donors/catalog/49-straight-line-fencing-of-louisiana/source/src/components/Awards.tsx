'use client'

import { client } from '@/lib/wssBridge'
import { Hammer, Ruler, ShieldCheck, Truck, Phone, Sparkles } from 'lucide-react'

export function Awards() {
  const items=[...client.content.values.map(v=>({icon:Sparkles,title:v.title,desc:v.body,source:''})), ...client.trust.reviews.map(r=>({icon:Sparkles,title:r.author,desc:r.text,source:r.sourceUrl}))]
  if (!items.length) return null
  return (
    <section id="awards" className="relative py-24 bg-background overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-card/30 to-background" />
      <div className="container mx-auto px-6 sm:px-8 lg:px-12 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-3 h-3 bg-[#2A3E23] rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">Why us</span>
            <div className="w-3 h-3 bg-[var(--client-accent)] rounded-full animate-pulse" />
          </div>
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-6 text-foreground">
            {client.content.whyHeadline || client.identity.businessName}
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
            
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {items.map(({ icon: Icon, title, desc, source }) => (
            <div
              key={title}
              className="relative p-7 rounded-2xl bg-card clean-border subtle-shadow hover:-translate-y-1 hover:shadow-lg gentle-animation float-gentle"
            >
              <div className="w-12 h-12 rounded-xl bg-[#2A3E23]/10 text-[#2A3E23] flex items-center justify-center mb-5">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-black text-xl text-foreground mb-2">{title}</h3>
              <p className="text-muted-foreground leading-relaxed">{desc}</p>
              {source && <a href={source} rel="noopener noreferrer" target="_blank" className="underline">Review source</a>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
