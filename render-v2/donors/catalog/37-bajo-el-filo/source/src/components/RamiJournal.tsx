import {getClient} from '@/wss/bridge';
const client=getClient();
import { copy } from "@/data/copy";
import { ChapterMark, Epigraph } from "./ChapterMark";

export function RamiJournal() {
  return (
    <section className="on-paper relative border-y border-hairline py-24 md:py-32">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex items-center justify-between">
          <span className="eyebrow">About</span>
          <ChapterMark n="IV" />
        </div>
        <div className="mt-10 grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-8">
            {[{heading:client.identity.businessName,body:client.content.about}].map((b) => (
              <div key={b.heading} className="mb-10 border-l border-edge/40 pl-6">
                <h3 className="font-serif text-3xl leading-tight md:text-5xl" style={{ color: "var(--paper-ink)" }}>
                  {b.heading}
                </h3>
                <p className="mt-5 max-w-2xl text-[17px] leading-relaxed" style={{ color: "var(--paper-steel)" }}>
                  {b.body}
                </p>
              </div>
            ))}
          </div>
          <aside className="col-span-12 md:col-span-4">
            <div className="border-t border-hairline pt-6">
              <div className="eyebrow">Lineage · in short</div>
              <ul className="mt-5 space-y-3 text-sm" style={{ color: "var(--paper-ink)" }}>
                {client.trust.badges.map(b=><li key={b.label}>{b.label}</li>)}
              </ul>
            </div>
            <div className="mt-10">
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
