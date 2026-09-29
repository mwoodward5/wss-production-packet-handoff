import {createFileRoute,Link} from '@tanstack/react-router';
import {BUSINESS} from '@/lib/business';
import {CLIENT} from '@/lib/wss';
import {FaqSchema} from '@/components/site/Schema';
const FAQ=CLIENT.content.faqs.map(f=>({...f,category:'Questions',sources:[] as {url:string;label:string}[]}));
export const Route=createFileRoute('/faq')({component:FaqPage});
export function FaqPage() {
  const categories = Array.from(new Set(FAQ.map((f) => f.category)));

  return (
    <>
      <FaqSchema items={FAQ.map(({ q, a }) => ({ q, a }))} />


      <section className="bg-bone pt-20 pb-12">
        <div className="container-edge">
          <div className="num-badge text-ink/40 mb-3">— FAQ</div>
          <h1 className="display-xl max-w-3xl">Answers, plainly.</h1>
          <p className="mt-6 max-w-2xl text-ink/70 text-lg leading-relaxed">
            Questions about {BUSINESS.name}.
          </p>
        </div>
      </section>

      <section className="bg-bone pb-28">
        <div className="container-edge max-w-3xl">
          {categories.map((cat) => {
            const items = FAQ.filter((f) => f.category === cat);
            return (
              <div key={cat} className="mt-12 first:mt-0">
                <div className="eyebrow text-ink/50 mb-4">— {cat}</div>
                <div className="border-t border-ink/15">
                  {items.map((f) => {
                    const idx = FAQ.indexOf(f);
                    const [lead, ...rest] = f.a.split(/(?<=\.)\s+/);
                    return (
                      <details key={f.q} className="group border-b border-ink/15 py-6">
                        <summary className="cursor-pointer flex items-start gap-6 list-none">
                          <span className="num-badge text-ink/40 pt-1.5 shrink-0">
                            № {String(idx + 1).padStart(2, "0")}
                          </span>
                          <span className="faq-question font-display text-xl md:text-2xl flex-1">
                            {f.q}
                          </span>
                          <span className="font-display text-2xl text-ink/40 group-open:rotate-45 transition-transform">
                            +
                          </span>
                        </summary>
                        <div className="mt-4 ml-[3.5rem] max-w-2xl">
                          <p className="faq-answer-lead text-[15px] text-ink leading-relaxed font-medium">
                            {lead}
                          </p>
                          {rest.length > 0 && (
                            <p className="mt-3 text-[15px] text-ink/70 leading-relaxed">
                              {rest.join(" ")}
                            </p>
                          )}
                          {f.sources.length > 0 && (
                            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs uppercase tracking-wider text-ink/50">
                              <span>Source:</span>
                              {f.sources.map((s) => (
                                <a
                                  key={s.url}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline underline-offset-4 hover:text-ink"
                                >
                                  {s.label} ↗
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="mt-16 bg-ink text-bone p-8 md:p-10">
            <div className="eyebrow text-volt mb-3">— Still have a question?</div>
            <h2 className="font-display text-3xl">
              We'd rather answer it than have you guess.
            </h2>
            <div className="mt-6 flex flex-wrap gap-4">
              <a href={`tel:${BUSINESS.phoneE164}`} className="btn-volt">
                Call {BUSINESS.phone}
              </a>
              <Link to="/contact" className="btn-ghost-bone">
                Send a message →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
