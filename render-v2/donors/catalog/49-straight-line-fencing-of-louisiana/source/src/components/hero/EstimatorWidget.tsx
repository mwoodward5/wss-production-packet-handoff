'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Phone, ArrowRight, Sparkles } from 'lucide-react'
import { client } from '@/lib/wssBridge'
import { SLF } from '@/lib/slfAssets'

type FenceType = string
const TYPES=client?.services.map(s=>({id:s.name,label:s.shortLabel,project:s.name})) || []

const HEIGHTS: { id: 4 | 6 | 8; label: string }[] = [
  { id: 4, label: "4'" },
  { id: 6, label: "6'" },
  { id: 8, label: "8'" },
]

export function EstimatorWidget() {
  const [type, setType] = useState<FenceType>(TYPES[0].id)
  const [feet, setFeet] = useState(120)
  const [height, setHeight] = useState<4 | 6 | 8>(6)

  const project = type

  // Animated type-pill underline
  const typeRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [pill, setPill] = useState({ x: 0, w: 0 })
  useEffect(() => {
    const el = typeRefs.current[type]
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [type])

  const handleLock = () => {
    const summary = `Project selections:\nService: ${type}\nRequested length: ${feet} ft\nRequested height: ${height} ft\nPlease discuss availability and pricing.`
    window.dispatchEvent(new CustomEvent('slf:prefill-quote', { detail: { projectType: project, message: summary } }))
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 1.1, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full max-w-md"
    >
      {/* Outer glow */}
      <div
        aria-hidden
        className="absolute -inset-px rounded-2xl pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, rgba(203,177,137,0.55), rgba(148,105,54,0.25) 40%, rgba(107,117,46,0.45) 100%)',
          filter: 'blur(10px)',
          opacity: 0.7,
        }}
      />

      <div
        className="relative rounded-2xl border border-white/20 overflow-hidden"
        style={{
          background:
            'linear-gradient(160deg, rgba(20,24,16,0.78), rgba(20,24,16,0.62))',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#cbb189]" />
            <span className="text-[11px] tracking-[0.2em] uppercase font-bold text-white/85">
              Project Planner
            </span>
          </div>
          <span className="text-[10px] text-white/50 tracking-wider uppercase">{client.identity.city}</span>
        </div>

        <div className="p-5 space-y-5">
          {/* Type pills */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/60 font-semibold mb-2">Service</div>
            <div className="relative flex flex-wrap gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
              <motion.div
                className="absolute top-1 bottom-1 rounded-lg pointer-events-none"
                style={{
                  background: 'linear-gradient(135deg, #946936, #6B752E)',
                  boxShadow: '0 4px 18px -4px rgba(148,105,54,0.6)',
                }}
                animate={{ x: pill.x, width: pill.w }}
                transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              />
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  ref={(el) => { typeRefs.current[t.id] = el }}
                  onClick={() => setType(t.id)}
                  className={`relative z-10 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    type === t.id ? 'text-white' : 'text-white/65 hover:text-white/90'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Length slider */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-white/60 font-semibold">Linear feet</div>
              <div className="text-white font-black text-lg tabular-nums">
                {feet}<span className="text-white/50 text-xs font-semibold ml-1">ft</span>
              </div>
            </div>
            <div className="relative h-6 flex items-center">
              {/* Ruler ticks */}
              <div className="absolute inset-x-0 top-0 flex justify-between pointer-events-none">
                {Array.from({ length: 17 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-px"
                    style={{
                      height: i % 4 === 0 ? 10 : 5,
                      background: 'rgba(255,255,255,0.22)',
                    }}
                  />
                ))}
              </div>
              <input
                type="range"
                min={20}
                max={500}
                step={5}
                value={feet}
                onChange={(e) => setFeet(parseInt(e.target.value))}
                className="slf-slider w-full"
                aria-label="Linear feet of fence"
              />
            </div>
            <div className="flex justify-between text-[10px] text-white/40 mt-1 font-medium">
              <span>20 ft</span><span>500 ft</span>
            </div>
          </div>

          {/* Height + live silhouette */}
          <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/60 font-semibold mb-2">Requested height</div>
              <div className="flex gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
                {HEIGHTS.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => setHeight(h.id)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      height === h.id
                        ? 'bg-[#cbb189] text-[#1a1f17] shadow-[0_3px_10px_-2px_rgba(203,177,137,0.5)]'
                        : 'text-white/65 hover:text-white'
                    }`}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Live fence silhouette */}
            <svg width="58" height="48" viewBox="0 0 58 48" className="text-[#cbb189]">
              <motion.g
                animate={{ scaleY: height === 4 ? 0.7 : height === 6 ? 0.9 : 1.05 }}
                style={{ transformOrigin: 'bottom center' }}
                transition={{ type: 'spring', damping: 18, stiffness: 200 }}
              >
                {[2, 12, 22, 32, 42, 52].map((x) => (
                  <rect key={x} x={x} y={6} width={4} height={38} rx={1} fill="currentColor" />
                ))}
                <rect x={0} y={16} width={58} height={2.5} fill="currentColor" opacity={0.7} />
                <rect x={0} y={34} width={58} height={2.5} fill="currentColor" opacity={0.7} />
              </motion.g>
              <rect x={0} y={44} width={58} height={4} fill="rgba(255,255,255,0.15)" />
            </svg>
          </div>

          {/* Price output */}
          <div
            className="rounded-xl p-4 border border-white/10 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, rgba(42,62,35,0.6), rgba(73,51,27,0.45))',
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/55 font-bold mb-1">
              Project pricing
            </div>
            <div className="text-white font-black text-2xl">Contact for a quote</div>
            <div className="text-[10px] text-white/50 mt-2 leading-relaxed">
              Requested dimensions are subject to confirmation.
            </div>
          </div>

          {/* CTAs */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              onClick={handleLock}
              className="group inline-flex items-center justify-center gap-2 bg-[#cbb189] hover:bg-[#d9c19a] text-[#1a1f17] font-black text-sm px-4 py-3 rounded-xl transition-all"
              style={{ boxShadow: '0 10px 30px -10px rgba(203,177,137,0.55)' }}
            >
              Use these details
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a
              href={SLF.phoneHref}
              aria-label={`Call ${SLF.phone}`}
              className="inline-flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/15 text-white font-bold px-3 rounded-xl transition-colors"
            >
              <Phone className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
