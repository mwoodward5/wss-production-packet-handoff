import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import Seo from "@/components/Seo";
import LightFrame from "@/components/LightFrame";
import SideRail from "@/components/SideRail";
import { ARTICLES } from "@/content/articles";

export default function Journal() {
  return (
    <>
      <Seo
        title="Journal · Field Notes — XPhotography Atlanta"
        description="Field notes on Atlanta weddings, editorial portraits, corporate headshot lighting, and the way light moves through this city — written by Xavier Jordan."
        path="/journal"
      />

      <section className="relative pt-44 pb-16 bg-paper overflow-hidden">
        <SideRail label="JOURNAL · 01" meta={["FIELD NOTES", "XJ · ATL"]} />
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="container">
          <div className="label-eyebrow text-molten mb-6">Folio 011 · Journal</div>
          <h1 className="font-display text-[11.2vw] md:text-[6.4vw] lg:text-[5.2vw] text-ivory leading-[0.88] tracking-[-0.03em] text-balance max-w-5xl">
            Field notes on light, <span className="italic text-molten">Atlanta</span>, and the work.
          </h1>
        </div>
      </section>

      <section className="pb-32 bg-paper">
        <div className="container">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-10 lg:gap-14">
            {ARTICLES.map((a, i) => (
              <Link
                key={a.slug}
                to={`/journal/${a.slug}`}
                className="group block"
              >
                <div className="font-mono text-[0.65rem] text-molten/80 tracking-widest mb-3">
                  N° {String(i + 1).padStart(3, "0")} · {a.category.toUpperCase()}
                </div>
                <LightFrame>
                  <img
                    src={a.coverImage} alt={a.title}
                    className="w-full aspect-[4/5] object-cover group-hover:scale-[1.02] transition-transform duration-700"
                  />
                </LightFrame>
                <h2 className="font-display text-2xl md:text-3xl text-ivory leading-tight mt-6 group-hover:text-molten transition-colors text-balance">
                  {a.title}
                </h2>
                <div className="font-mono text-xs text-ivory/50 mt-3 flex items-center gap-3">
                  <span>{new Date(a.datePublished).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  <span>·</span>
                  <span>{a.readingTime}</span>
                </div>
                <p className="text-ivory/65 leading-relaxed mt-3 text-pretty">{a.description}</p>
                <div className="inline-flex items-center gap-2 label-eyebrow text-molten mt-5">
                  Read <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
