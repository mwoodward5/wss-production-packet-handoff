import * as React from "react";
import { Gate, useTrust } from "../TrustProvider";
import { formatCount } from "./primitives";

/** Follower counts across platforms. Counts render only when present in config. */
export function SocialFollowerBar() {
  const cfg = useTrust();
  const accounts = cfg.social.accounts ?? [];
  return (
    <Gate id="SocialFollowerBar" when={accounts.length > 0}>
      <ul className="tw-row" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {accounts.map((a) => (
          <li key={a.platform}>
            <a className="tw-chip" href={a.url} target="_blank" rel="noopener noreferrer me"
               aria-label={`${a.platform} ${a.handle}${a.followers ? `, ${a.followers.toLocaleString()} followers` : ""} (opens in a new tab)`}>
              <span style={{ textTransform: "capitalize", color: "var(--tw-text)" }}>{a.platform}</span>
              <span>{a.handle}</span>
              {a.followers ? <strong style={{ color: "var(--tw-text)" }}>{formatCount(a.followers)}</strong> : null}
            </a>
          </li>
        ))}
      </ul>
    </Gate>
  );
}
