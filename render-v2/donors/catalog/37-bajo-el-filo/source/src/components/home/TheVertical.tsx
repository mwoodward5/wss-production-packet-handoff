import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ScrollFrame } from "@/components/frames/ScrollFrame";
import { ChapterMark } from "@/components/ChapterMark";
import { verticalClips } from "@/data/media";
import { ProofVideo } from "@/components/ProofVideo";
import { AngulationDiagram } from "./AngulationDiagram";

/**
 * A blade-vocabulary reader: one clip in the scroll, mapped to one of the
 * five numbered angles of attack shared across Sayoc / Pekiti-Tirsia /
 * Ilustrisimo. Left column names the read; right column draws the angle.
 * No duplicate video tiles — the strip beneath the fold is gone.
 */
const breakdowns: Array<{
  angle: 1 | 2 | 3 | 4 | 5;
  angleLabel: string;
  measure: string;
  beat: string;
  note: string;
  seal: string;
}> = [
  { angle: 1, angleLabel: "Angle 1 · high forehand", measure: "Long · outside", beat: "On the half", seal: "壱", note: "Temple to opposite hip. The line the receiver reads first." },
  { angle: 2, angleLabel: "Angle 2 · high backhand", measure: "Long · inside",  beat: "Off the pause", seal: "弐", note: "The mirror of #1. Same intent, opposite geometry." },
  { angle: 3, angleLabel: "Angle 3 · horizontal fore", measure: "Mid · ribs", beat: "On the up", seal: "参", note: "Flat plane at the ribs. Waist-line cut, no diagonal." },
  { angle: 4, angleLabel: "Angle 4 · horizontal back", measure: "Mid · ribs", beat: "On contact", seal: "肆", note: "Returning line. Recovery beat lives here." },
  { angle: 5, angleLabel: "Angle 5 · thrust", measure: "Zero · centerline", beat: "After the break", seal: "伍", note: "Straight thrust to sternum. Fastest, hardest to read." },
];

export function TheVertical() {
  const clips = verticalClips();
  const [i, setI] = useState(0);
  const clip = clips[i % clips.length];
  const bd = breakdowns[i % breakdowns.length];

  return (
    <section aria-labelledby="vertical-h" className="relative bg-ink py-24 md:py-32">
      <div className="mx-auto max-w-[1440px] px-6 md:px-10">
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <ChapterMark n="V" />
              <span className="eyebrow text-edge">The vertical · V</span>
            </div>
            <h2
              id="vertical-h"
              className="mt-4 max-w-3xl font-serif text-4xl leading-[1.02] tracking-[-0.02em] text-bone md:text-6xl"
            >
              Five angles.
              <span className="block italic text-bone-dim">One vocabulary.</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-bone-dim md:text-base">
              Sayoc, Pekiti-Tirsia, Kali Ilustrisimo — the first numbered angles are
              shared vocabulary across the traditions Rami trains. Read the line,
              read the measure, read the beat.
            </p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <button
              onClick={() => setI((v) => (v - 1 + breakdowns.length) % breakdowns.length)}
              className="glass eyebrow h-11 w-11 rounded-full text-bone"
              aria-label="Previous angle"
            >←</button>
            <span className="numeral w-16 text-center text-bone">
              {String((i % breakdowns.length) + 1).padStart(2, "0")} / {String(breakdowns.length).padStart(2, "0")}
            </span>
            <button
              onClick={() => setI((v) => (v + 1) % breakdowns.length)}
              className="glass eyebrow h-11 w-11 rounded-full text-bone"
              aria-label="Next angle"
            >→</button>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-12 gap-8">
          {/* Left — reading */}
          <div className="col-span-12 md:col-span-3">
            <div className="border-t border-hairline pt-4">
              <div className="eyebrow text-edge">{bd.angleLabel.split("·")[0].trim()}</div>
              <div className="mt-4 space-y-5">
                <div>
                  <div className="text-xs uppercase tracking-widest text-bone-dim">Line</div>
                  <div className="font-serif text-2xl leading-tight text-bone">{bd.angleLabel.split("·")[1]?.trim()}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-bone-dim">Measure</div>
                  <div className="font-serif text-2xl leading-tight text-bone">{bd.measure.split("·")[1]?.trim()}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-bone-dim">Beat</div>
                  <div className="font-serif text-2xl leading-tight text-bone">{bd.beat}</div>
                </div>
              </div>
              <p className="mt-6 text-sm leading-relaxed text-bone-dim">
                {bd.note}
              </p>
            </div>
          </div>

          {/* Center — hero clip */}
          <div className="col-span-12 md:col-span-6">
            <ScrollFrame aspect="9/16" seal={bd.seal} className="mx-auto max-w-md">
              <ProofVideo key={clip.id} item={clip} eager className="h-full w-full" />
            </ScrollFrame>
          </div>

          {/* Right — angulation diagram */}
          <div className="col-span-12 md:col-span-3">
            <div className="border-t border-hairline pt-4">
              <div className="eyebrow text-edge">Angulation</div>
              <div key={bd.angle} className="mt-4 text-edge">
                <AngulationDiagram angle={bd.angle} />
              </div>
              <div className="mt-2 text-xs uppercase tracking-widest text-bone-dim">
                Shared FMA numbering
              </div>
              <div className="mt-6 grid grid-cols-5 gap-1">
                {breakdowns.map((b) => (
                  <button
                    key={b.angle}
                    onClick={() => setI(b.angle - 1)}
                    className={`aspect-square border text-sm font-serif italic transition ${
                      b.angle === bd.angle
                        ? "border-edge bg-edge/15 text-edge"
                        : "border-hairline text-bone-dim hover:border-edge/60 hover:text-bone"
                    }`}
                    aria-label={`Show angle ${b.angle}`}
                  >
                    {b.angle}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="mt-8 flex items-center justify-center gap-4 md:hidden">
          <button
            onClick={() => setI((v) => (v - 1 + breakdowns.length) % breakdowns.length)}
            className="glass eyebrow h-11 w-11 rounded-full text-bone"
            aria-label="Previous angle"
          >←</button>
          <span className="numeral text-bone">
            {String((i % breakdowns.length) + 1).padStart(2, "0")} / {String(breakdowns.length).padStart(2, "0")}
          </span>
          <button
            onClick={() => setI((v) => (v + 1) % breakdowns.length)}
            className="glass eyebrow h-11 w-11 rounded-full text-bone"
            aria-label="Next angle"
          >→</button>
        </div>

        <div className="mt-12 text-center">
          <Link to="/media" className="eyebrow inline-flex items-center gap-2 text-edge">
            Full library →
          </Link>
        </div>
      </div>
    </section>
  );
}
