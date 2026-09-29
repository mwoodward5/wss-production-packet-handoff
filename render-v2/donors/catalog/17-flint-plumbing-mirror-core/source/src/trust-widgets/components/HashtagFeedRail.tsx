import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import type { MediaItem } from "../trust.config";

/** Branded-hashtag rail. Requires config.proof.hashtag plus real media. */
export function HashtagFeedRail({ items }: { items?: MediaItem[] }) {
  const cfg = useTrust();
  const tag = cfg.proof.hashtag;
  const media = items?.length ? items : (cfg.proof.ugc ?? []).filter((m) => m.tags?.includes(tag ?? ""));
  return (
    <Gate id="HashtagFeedRail" when={Boolean(tag) && media.length > 0}>
      <div>
        <p className="tw-eyebrow">#{tag?.replace(/^#/, "")}</p>
        <ul className="tw-rail" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {media.map((m) => (
            <li key={m.id} style={{ width: 180 }}>
              <div style={{ aspectRatio: 1, borderRadius: "var(--tw-radius)", overflow: "hidden", border: "1px solid var(--tw-line)" }}>
                <img className="tw-img" src={m.src} alt={m.alt} loading="lazy" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Gate>
  );
}
