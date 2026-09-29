'use client'

import { gallery, SLF } from '@/lib/slfAssets'

export function Portfolio() {
  const featured = gallery[0]
  const supporting = gallery.slice(1,4)
  if (!featured) return null

  return (
    <section id="portfolio" className="relative py-32 bg-background">
      <div className="container mx-auto px-6 sm:px-8 lg:px-12">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-3 h-3 bg-[#6B752E] rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">Photos</span>
            <div className="w-3 h-3 bg-[var(--client-accent)] rounded-full animate-pulse" />
          </div>
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-6">
            Project gallery
          </h2>
          <p className="text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {SLF.name}
          </p>
        </div>

        <div className="max-w-6xl mx-auto">
          <div className="relative bg-card clean-border rounded-3xl overflow-hidden elevated-shadow">
            <div className="aspect-[16/9] overflow-hidden">
              <img src={featured.url} alt={featured.alt} className="w-full h-full object-cover" loading="lazy" />
            </div>
            <div className="p-8 lg:p-12">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="bg-[#2A3E23]/10 text-[#2A3E23] px-3 py-1 rounded-full text-sm font-medium">
                  Photo 01
                </span>
              </div>
              <h3 className="text-3xl lg:text-4xl font-bold text-foreground mb-3">
                {SLF.name}
              </h3>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                Contact us to discuss your project.
              </p>
              <a
                href={SLF.phoneHref}
                className="inline-flex items-center gap-2 bg-[#2A3E23] hover:bg-[#1f2e1a] text-white font-semibold px-6 py-3 rounded-md gentle-animation"
              >
                Get your own quote
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8">
            {supporting.map((g) => (
              <div key={g.url} className="rounded-2xl overflow-hidden clean-border subtle-shadow">
                <div className="aspect-[4/3] overflow-hidden">
                  <img src={g.url} alt={g.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-700" loading="lazy" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
