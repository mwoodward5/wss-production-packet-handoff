import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { voiceAnswers } from "../seo/voice";

/**
 * Direct 40-60 word answers to spoken queries ("who's the best X near me",
 * "are you open now", "how much does X cost"). Marked up for speakable schema.
 */
export function VoiceAnswerBlock({ limit }: { limit?: number }) {
  const cfg = useTrust();
  const answers = voiceAnswers(cfg).slice(0, limit);
  return (
    <Gate id="VoiceAnswerBlock" when={answers.length > 0}>
      <div className="tw-grid" style={{ gap: "1.1rem" }}>
        {answers.map((a) => (
          <article key={a.id} className="tw-card">
            <h3 className="tw-h tw-h3" style={{ fontSize: "1.02rem" }}>{a.question}</h3>
            <p className="tw-voice-answer" style={{ margin: 0, fontSize: ".93rem", lineHeight: 1.55 }}>{a.answer}</p>
            {a.updatedAt ? <p className="tw-muted" style={{ margin: ".5rem 0 0", fontSize: ".76rem" }}>Updated {a.updatedAt}</p> : null}
          </article>
        ))}
      </div>
    </Gate>
  );
}
