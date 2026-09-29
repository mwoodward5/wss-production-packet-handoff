import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Seo from "@/components/Seo";
import SideRail from "@/components/SideRail";
import FrameStudio from "@/components/FrameStudio";

export default function Studio() {
  return (
    <>
      <Seo
        title="Frame Studio — remaster your photo · XPhotography Atlanta"
        description="Drop a photo and remaster it through Xavier Jordan's six signature editorial looks. Export a framed, watermarked frame. Free, private, browser-only."
        path="/studio"
      />

      <section className="relative pt-44 pb-16 bg-paper overflow-hidden">
        <SideRail label="STUDIO 01 · LIVE" meta={["XJ · ATL", "REMASTER · LAB"]} />
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="container max-w-[1400px]">
          <div className="grid lg:grid-cols-12 gap-8 items-end mb-12">
            <div className="lg:col-span-8">
              <div className="label-eyebrow text-molten mb-6">Folio 010 · Frame Studio</div>
              <h1 className="font-display text-[9.6vw] md:text-[5.6vw] lg:text-[4.4vw] text-ivory leading-[0.88] tracking-[-0.03em] text-balance">
                Remaster a photo through <span className="italic text-molten">Xavier's looks</span>.
              </h1>
            </div>
            <div className="lg:col-span-4 text-ivory/70 text-base leading-relaxed">
              Six color grades pulled directly from how I actually finish weddings, portraits, and editorial work. Drop a photo, choose a look, export a frame. Nothing leaves your browser.
            </div>
          </div>

          <FrameStudio />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24 bg-paper-soft border-y border-ivory/10">
        <div className="container max-w-6xl">
          <div className="label-eyebrow text-molten mb-12">How it works</div>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              { n: "01", t: "Upload", b: "Drag in any photo from your phone, camera, or desktop. Processing happens locally — your image never uploads." },
              { n: "02", t: "Choose a look", b: "Six signature grades: Atlanta Gold Hour, Buckhead Noir, Ivory Linen, Cinema 2:35, Inman Park Film, Dream Mode. Tune intensity to taste." },
              { n: "03", t: "Export or send", b: "Download a high-resolution PNG framed in XJ chrome, or send Xavier a note about a real session." },
            ].map((s) => (
              <div key={s.n} className="border border-ivory/10 p-8">
                <div className="font-display text-6xl text-molten/80 mb-4">{s.n}</div>
                <div className="font-display text-2xl text-ivory mb-3">{s.t}</div>
                <p className="text-ivory/65 leading-relaxed">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-28 bg-paper">
        <div className="container max-w-4xl text-center">
          <div className="label-eyebrow text-molten mb-6">When you're ready for the real thing</div>
          <h2 className="font-display text-[2.7rem] md:text-[3.375rem] text-ivory leading-[0.95] mb-8 text-balance">
            A grade is a finish. <span className="italic text-molten">Light is the work.</span>
          </h2>
          <p className="text-ivory/70 max-w-2xl mx-auto mb-10 leading-relaxed">
            Frame Studio shows you what color can do. The frames you'll keep on your wall come from being in the right room at the right minute. That's what I do.
          </p>
          <Link to="/contact" className="inline-flex items-center gap-3 px-8 py-4 bg-molten text-ink label-eyebrow hover:bg-ivory transition">
            Reserve a Session <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
