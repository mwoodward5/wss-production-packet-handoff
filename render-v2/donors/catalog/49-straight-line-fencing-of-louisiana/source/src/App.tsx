import { HeroFlagship } from './components/HeroFlagship'
import { Portfolio } from './components/Portfolio'
import { Awards } from './components/Awards'
import { About } from './components/About'
import { Services } from './components/Services'
import { Team } from './components/Team'
import { Contact } from './components/Contact'
import { Footer } from './components/Footer'
import { client, dataError } from './lib/wssBridge'
import { MotionConfig } from 'framer-motion'

export default function App() {
  if (dataError) return <main role="alert" className="min-h-screen grid place-items-center"><h1>{dataError}</h1></main>
  const route = window.location.pathname.replace(/\/$/, '') || '/'
  const service = client.services.find(s=>s.href === route)
  if(route !== '/') return service ? <MotionConfig reducedMotion="user"><main className="container mx-auto px-6 py-24"><a href="/">← Home</a><div className="relative bg-card clean-border rounded-3xl p-8 lg:p-12 my-8"><h1 className="text-5xl font-black mb-6">{service.name}</h1><p className="text-xl leading-relaxed whitespace-pre-line">{service.description}</p><a href={client.identity.phoneTel} className="inline-flex bg-[#2A3E23] text-white px-6 py-3 rounded-md mt-8">{client.identity.phoneDisplay}</a></div></main><Footer /></MotionConfig> : <main className="min-h-screen grid place-items-center"><div><h1 className="text-4xl font-black">404</h1><p>Page not found</p><a href="/">Return home</a></div></main>
  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-background text-foreground" style={{ overflow: 'visible' }}>
      <main className="relative" role="main" style={{ overflow: 'visible' }}>
        <HeroFlagship />
        <Services />
        <Portfolio />
        <About />
        <Team />
        <Awards />
        <Contact />
      </main>
      <Footer />
    </div>
    </MotionConfig>
  )
}
