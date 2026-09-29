/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: the round reviewer avatar (photo, else initials puck).
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT:
 * │   trustConfig.proof.reviews[].avatarUrl <- Places Details
 * │        reviews[].authorAttribution.photoUri   (copy the URL verbatim)
 * │   trustConfig.proof.reviews[].author    <- reviews[].authorAttribution.displayName
 * │   trustConfig.proof.reviews[].platform  <- "Google" | "Yelp" | "Facebook"
 * │ HARD RULE: keep referrerPolicy="no-referrer" below — Google's photo CDN
 * │ returns 403 to referred requests, which is what makes faces "disappear".
 * │ IF YOU CANNOT SOURCE A PHOTO: omit avatarUrl. Never substitute a stock face.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Reviews and faces
 * └──────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";

const PLATFORM_TINT: Record<string, string> = {
  Google: "oklch(0.72 0.16 45)",
  Yelp: "oklch(0.6 0.21 25)",
  Facebook: "oklch(0.58 0.17 255)",
  BBB: "oklch(0.55 0.13 240)",
};

/**
 * Reviewer avatar. Uses the real profile photo when the refresh job captured
 * one, otherwise draws a deterministic monogram puck — never a stock face.
 */
export function ReviewerFace({
  name,
  avatarUrl,
  platform,
  size = 44,
}: {
  name: string;
  avatarUrl?: string;
  platform?: string;
  size?: number;
}) {
  const [broken, setBroken] = React.useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const hue = Array.from(name).reduce((a, c) => (a + c.charCodeAt(0)) % 360, 0);
  const ring = platform ? PLATFORM_TINT[platform] : undefined;

  const common: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "999px",
    flex: "0 0 auto",
    boxShadow: ring ? `0 0 0 2px ${ring}, 0 8px 22px -10px rgba(0,0,0,.7)` : "0 8px 22px -10px rgba(0,0,0,.7)",
  };

  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} profile photo`}
        loading="lazy"
        /**
         * MIRRORING NOTE: Google profile photos are served from
         * lh3.googleusercontent.com and are refused when a Referer header is
         * sent from an unknown origin. `no-referrer` is what makes the real
         * Google reviewer faces render on every mirrored domain.
         */
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ ...common, objectFit: "cover" }}
      />
    );
  }


  return (
    <span
      aria-hidden
      style={{
        ...common,
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--tw-font-heading)",
        fontWeight: 800,
        fontSize: size * 0.36,
        letterSpacing: ".02em",
        color: "var(--tw-text)",
        background: `linear-gradient(140deg, oklch(0.55 0.09 ${hue}), oklch(0.35 0.07 ${(hue + 60) % 360}))`,
      }}
    >
      {initials || "★"}
    </span>
  );
}

/** Overlapping face pile used above aggregate ratings. */
export function FacePile({
  people,
  max = 6,
}: {
  people: { author: string; avatarUrl?: string; platform?: string }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  if (!shown.length) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((p, i) => (
        <span key={`${p.author}-${i}`} style={{ marginLeft: i === 0 ? 0 : -14, zIndex: shown.length - i }}>
          <ReviewerFace name={p.author} avatarUrl={p.avatarUrl} platform={p.platform} size={36} />
        </span>
      ))}
      {people.length > max ? (
        <span
          className="tw-muted"
          style={{ marginLeft: 10, fontSize: ".82rem", fontWeight: 600 }}
        >
          +{people.length - max} more
        </span>
      ) : null}
    </span>
  );
}
