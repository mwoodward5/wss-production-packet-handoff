import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { client, sitePlan } from '@/lib/wssBridge'
import { SLF } from '@/lib/slfAssets'
import { Phone, Mail, MapPin, Clock, Facebook, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = 'idle' | 'error'

export function Contact() {
  return <ContactForm />
}

function ContactForm() {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', projectType: '', address: '', message: '' })
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const messageRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<{ projectType?: string; message?: string }>).detail || {}
      setFormData((p) => ({
        ...p,
        projectType: detail.projectType || p.projectType,
        message: detail.message ? (p.message ? `${p.message}\n\n${detail.message}` : detail.message) : p.message,
      }))
      setTimeout(() => messageRef.current?.focus(), 600)
    }
    window.addEventListener('slf:prefill-quote', onPrefill as EventListener)
    return () => window.removeEventListener('slf:prefill-quote', onPrefill as EventListener)
  }, [])

  const isSubmitting = false

  const mailtoHref = () => {
    const subject = encodeURIComponent(`Quote request — ${formData.name || 'Website'}`)
    const body = encodeURIComponent(`Name: ${formData.name}\nPhone: ${formData.phone}\nEmail: ${formData.email}\nProject: ${formData.projectType}\nAddress: ${formData.address}\n\n${formData.message}`)
    return `mailto:${SLF.email}?subject=${subject}&body=${body}`
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isSubmitting) return
    if (!formData.name.trim() || !formData.email.trim() || !formData.phone.trim() || !formData.message.trim()) {
      setStatus('error')
      setErrorMsg('Please fill in name, email, phone, and project details.')
      return
    }
    if (SLF.email) window.location.href = mailtoHref()
    else {setStatus('error');setErrorMsg('Please call to discuss your project.')}
  }

  const set = (k: keyof typeof formData) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFormData((p) => ({ ...p, [k]: e.target.value }))

  return (
    <section id="contact" className="relative py-28 bg-card/30">
      <div className="container mx-auto px-6 sm:px-8 lg:px-12">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="w-3 h-3 bg-[#6B752E] rounded-full animate-pulse" />
            <span className="text-sm font-semibold text-muted-foreground tracking-wider uppercase">Get a quote</span>
            <div className="w-3 h-3 bg-[var(--client-accent)] rounded-full animate-pulse" />
          </div>
          <h2 className="text-5xl sm:text-6xl lg:text-7xl font-black leading-tight mb-6">
            {client.content.ctaHeadline || "Contact"}
          </h2>
          <p className="text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            {sitePlan?.content?.contact || client.content.ctaBody}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 max-w-6xl mx-auto">
          <div className="lg:col-span-3 bg-background clean-border rounded-3xl overflow-hidden elevated-shadow">
            <div className="bg-card/50 px-8 py-6 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-foreground mb-1">Request a quote</h3>
                <p className="text-muted-foreground text-sm">{SLF.email ? 'Prepare an email in your mail app. This site does not send your request.' : 'Call to discuss your project.'}</p>
              </div>
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-3 h-3 bg-[#6B752E] rounded-full" />
                <span className="text-sm text-muted-foreground font-medium">Contact details</span>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-foreground mb-2">Name</label>
                  <input id="name" type="text" required maxLength={120} value={formData.name} onChange={set('name')}
                    className="w-full px-4 py-3 rounded-xl bg-card border border-border focus:outline-none focus:ring-2 focus:ring-[#6B752E]/50" placeholder="Your name" />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-semibold text-foreground mb-2">Phone</label>
                  <input id="phone" type="tel" required maxLength={40} value={formData.phone} onChange={set('phone')}
                    className="w-full px-4 py-3 rounded-xl bg-card border border-border focus:outline-none focus:ring-2 focus:ring-[#6B752E]/50" placeholder="Your phone number" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-foreground mb-2">Email</label>
                  <input id="email" type="email" required maxLength={255} value={formData.email} onChange={set('email')}
                    className="w-full px-4 py-3 rounded-xl bg-card border border-border focus:outline-none focus:ring-2 focus:ring-[#6B752E]/50" placeholder="you@example.com" />
                </div>
                <div>
                  <label htmlFor="projectType" className="block text-sm font-semibold text-foreground mb-2">Project type</label>
                  <select id="projectType" value={formData.projectType} onChange={set('projectType')}
                    className="w-full px-4 py-3 rounded-xl bg-card border border-border focus:outline-none focus:ring-2 focus:ring-[#6B752E]/50">
                    <option value="">Select…</option>
                    {client.services.map(s=><option key={s.name}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="address" className="block text-sm font-semibold text-foreground mb-2">Property address (optional)</label>
                <input id="address" type="text" maxLength={255} value={formData.address} onChange={set('address')}
                  className="w-full px-4 py-3 rounded-xl bg-card border border-border focus:outline-none focus:ring-2 focus:ring-[#6B752E]/50" placeholder="Street, city" />
              </div>
              <div>
                <label htmlFor="message" className="block text-sm font-semibold text-foreground mb-2">Project details</label>
                <textarea id="message" ref={messageRef} rows={5} required maxLength={2000} value={formData.message} onChange={set('message')}
                  className="w-full px-4 py-3 rounded-xl bg-card border border-border focus:outline-none focus:ring-2 focus:ring-[#6B752E]/50 resize-none"
                  placeholder="Approximate length, fence style, gates, timeline…" />
              </div>
              {status === 'error' && (
                <div role="alert" aria-live="assertive" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                  <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <div className="font-bold text-destructive">{errorMsg || 'Something went wrong.'}</div>
                    <div className="text-foreground/80 mt-1">
                      Call <a href={SLF.phoneHref} className="font-semibold underline">{SLF.phone}</a>
                      {SLF.email && <> or <a href={mailtoHref()} className="font-semibold underline">email us directly</a></>}.
                    </div>
                  </div>
                </div>
              )}
              <button type="submit" disabled={!SLF.email}
                className="w-full py-4 rounded-xl bg-[#2A3E23] text-white font-black text-lg hover:bg-[#1f2e1a] gentle-animation disabled:opacity-50">
                {SLF.email ? 'Open email draft' : 'Call to discuss your project'}
              </button>
            </form>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {client.trust.bookingUrl && <a href={client.trust.bookingUrl} target="_blank" rel="noopener noreferrer" className="block bg-background clean-border rounded-2xl p-6 subtle-shadow font-bold">Book an appointment →</a>}
            <a href={SLF.phoneHref} className="block bg-[#2A3E23] hover:bg-[#1f2e1a] gentle-animation text-white rounded-2xl p-6 elevated-shadow">
              <div className="flex items-center gap-3 mb-2"><Phone className="w-5 h-5" /><span className="text-sm font-semibold tracking-wider uppercase">Call for an estimate</span></div>
              <div className="text-3xl font-black">{SLF.phone}</div>
              <div className="text-white/80 text-sm mt-1">{SLF.hours}</div>
            </a>
            {SLF.email && <a href={`mailto:${SLF.email}`} className="block bg-background clean-border rounded-2xl p-6 subtle-shadow hover:-translate-y-0.5 gentle-animation">
              <div className="flex items-center gap-3 mb-1"><Mail className="w-5 h-5 text-[var(--client-accent)]" /><span className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">Email</span></div>
              <div className="font-bold text-foreground break-all">{SLF.email}</div>
            </a>}
            <div className="bg-background clean-border rounded-2xl p-6 subtle-shadow">
              <div className="flex items-center gap-3 mb-2"><MapPin className="w-5 h-5 text-[#6B752E]" /><span className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">Service area</span></div>
              <div className="font-bold text-foreground">{SLF.city}</div>
              <div className="text-muted-foreground text-sm">{client.trust.areas.join(" · ")}</div>
              {sitePlan?.content?.['service-area'] && <p className="text-muted-foreground text-sm whitespace-pre-line mt-3">{sitePlan.content['service-area']}</p>}
              {SLF.googleMaps && <a href={SLF.googleMaps} target="_blank" rel="noopener noreferrer" className="inline-flex mt-3 text-sm font-semibold text-[#2A3E23] hover:underline">
                Open in Google Maps →
              </a>}
            </div>
            {SLF.hours && <div className="bg-background clean-border rounded-2xl p-6 subtle-shadow">
              <div className="flex items-center gap-3 mb-2"><Clock className="w-5 h-5 text-[#49331B]" /><span className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">Hours</span></div>
              <div className="font-bold text-foreground">{SLF.hours}</div>
            </div>}
            {SLF.facebook && <a href={SLF.facebook} target="_blank" rel="noopener noreferrer" className="block bg-background clean-border rounded-2xl p-6 subtle-shadow hover:-translate-y-0.5 gentle-animation">
              <div className="flex items-center gap-3"><Facebook className="w-5 h-5 text-[var(--client-accent)]" /><span className="font-semibold text-foreground">Follow on Facebook</span></div>
            </a>}
          </div>
        </div>
      </div>
    </section>
  )
}
