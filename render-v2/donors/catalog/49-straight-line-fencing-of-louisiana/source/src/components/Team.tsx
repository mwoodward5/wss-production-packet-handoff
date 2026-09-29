'use client'

import { gallery, SLF } from '@/lib/slfAssets'

const rotations = ['rotate-2', '-rotate-1', 'rotate-1', '-rotate-2', 'rotate-3', '-rotate-1', 'rotate-1', '-rotate-2', 'rotate-2', '-rotate-1', 'rotate-1', '-rotate-2', 'rotate-2', '-rotate-1', 'rotate-1']

export function Team() {
  if (!gallery.length) return null
  return (
    <div id="team" className="relative py-28 bg-background w-full" style={{ overflow: 'visible' }}>
      <div className="container mx-auto px-6 sm:px-8 lg:px-12" style={{ overflow: 'visible' }}>
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-3 h-3 bg-[var(--client-accent)] rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">Gallery</span>
            <div className="w-3 h-3 bg-[#6B752E] rounded-full animate-pulse" />
          </div>
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-6 text-foreground">
            Gallery
          </h2>
          <p className="text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {SLF.name}
          </p>
        </div>

        <div className="max-w-7xl mx-auto" style={{ overflow: 'visible' }}>
          <div className="bg-gradient-to-br from-[#1a1f17] via-[#0f1310] to-[#1a1f17] p-6 sm:p-10 rounded-2xl shadow-2xl border border-black/40">
            <div className="bg-[#f5efe2] rounded-xl p-6 sm:p-10 relative"
                 style={{
                   backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(122,86,42,0.05) 1px, transparent 1px), radial-gradient(circle at 70% 70%, rgba(148,105,54,0.04) 1px, transparent 1px)',
                   backgroundSize: '30px 30px, 45px 45px',
                 }}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 lg:gap-8" style={{ overflow: 'visible' }}>
                {gallery.slice(0,15).map((g, i) => (
                  <div
                    key={g.url}
                    className={`relative transform ${rotations[i]} hover:rotate-0 hover:scale-105 hover:z-20 transition-all duration-500`}
                    style={{ filter: 'drop-shadow(4px 6px 10px rgba(0,0,0,0.25))' }}
                  >
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-gradient-to-br from-red-500 to-red-700 rounded-full shadow-md border border-red-800 z-10" />
                    <div className="bg-white p-3 pb-8 border border-gray-200">
                      <div className="aspect-[4/5] overflow-hidden">
                        <img src={g.url} alt={g.alt} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <div className="mt-3 text-center text-xs font-mono text-gray-500 tracking-wider">
                        {SLF.name}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
