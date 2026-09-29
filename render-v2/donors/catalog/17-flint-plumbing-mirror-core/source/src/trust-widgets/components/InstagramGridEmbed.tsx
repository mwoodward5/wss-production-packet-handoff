import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import type { MediaItem } from "../trust.config";

/**
 * Instagram grid. Pass `items` from a server adapter (adapters/instagram.ts),
 * or leave it out to use the curated fallback in config.proof.ugc.
 */
export function InstagramGridEmbed({ items, count = 9 }: { items?: MediaItem[]; count?: number }) {
  const cfg = useTrust();
  const ig = cfg.social.accounts?.find((a) => a.platform === "instagram");
  const media = (items?.length ? items : cfg.proof.ugc ?? []).slice(0, count);
  return (
    <Gate id="InstagramGridEmbed" when={media.length > 0}>
      <div>
        <div className="tw-row" style={{ justifyContent: "space-between", marginBottom: ".8rem" }}>
          <span className="tw-eyebrow" style={{ margin: 0 }}>Latest on Instagram</span>
          {ig ? <a className="tw-btn tw-btn--ghost" href={ig.url} target="_blank" rel="noopener noreferrer me">{ig.handle}</a> : null}
        </div>
        <div className="tw-tiles">
          {media.map((m) => (
            <a key={m.id} className="tw-tile" href={m.sourceUrl ?? ig?.url ?? "#"} target="_blank" rel="noopener noreferrer nofollow" style={{ cursor: "pointer" }}>
              <img className="tw-img" src={m.src} alt={m.alt} loading="lazy" width={m.width} height={m.height} />
            </a>
          ))}
        </div>
      </div>
    </Gate>
  );
}
