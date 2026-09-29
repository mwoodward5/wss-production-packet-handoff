"use strict";
/* Sanitize brand-forge-express into a truthful, token-driven HVAC donor.
 *
 * Every replacement below is an exact-string swap that THROWS if the source
 * text is not found, so a silent partial port is impossible.
 *
 * What it removes, and why:
 *   · 555-000-0000 / hello@example.com — a fake NAP that would ship on every
 *     HVAC mirror. Replaced by tokens that COLLAPSE when the business has no
 *     verified phone or email (truth law: absent, never invented).
 *   · [AREA_2..AREA_8] — eight invented neighbouring towns. The engine verifies
 *     exactly one service-area city, so the list collapses to that city.
 *   · [BUSINESS_TAGLINE] — no verified source; dropped from the logo alt.
 *   · mission-mechanical-* asset filenames — a real business's name.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = "C:/Users/Main/Documents/Dark Signal/site-forge-lane/donors/brand-forge-express";
const p = (...r) => path.join(ROOT, ...r);
const edits = [];

function rewrite(rel, pairs) {
  const file = p(rel);
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`[${rel}] source text not found:\n${from.slice(0, 160)}`);
    const before = text;
    text = text.split(from).join(to);
    if (text === before) throw new Error(`[${rel}] replacement was a no-op`);
  }
  fs.writeFileSync(file, text);
  edits.push(`${rel}: ${pairs.length} replacement(s)`);
}

function write(rel, text) {
  fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
  fs.writeFileSync(p(rel), text);
  edits.push(`${rel}: written`);
}

// ─────────────────────────────────────────────────────────── token module
write("src/data/tokens.ts", `// src/data/tokens.ts — hydration tokens for the mirror engine.
//
// The engine text-replaces [TOKEN] (source convention) / {{TOKEN}} (installed
// donor convention) in the compiled bundle. A token the engine could not
// verify is replaced with an EMPTY string, so every read goes through
// filled(), and every caller must collapse its UI when the value is empty.
// Reads go through a Record lookup so the bundler cannot constant-fold the
// placeholder away before the engine gets a chance to substitute it.
const TOKENS: Record<string, string> = {
  PHONE: "[PHONE]",
  PHONE_DIGITS: "[PHONE_DIGITS]",
  EMAIL: "[EMAIL]",
  LOGO_URL: "[LOGO_URL]",
  BUSINESS_NAME: "[BUSINESS_NAME]",
};

function filled(key: string): string {
  const raw = TOKENS[key] ?? "";
  // Un-substituted in either convention => the fact is absent, not empty.
  if (raw.charAt(0) === "[" || raw.slice(0, 2) === "{{") return "";
  return raw.trim();
}

export const sitePhone = () => filled("PHONE");
export const siteEmail = () => filled("EMAIL");
export const siteLogo = () => filled("LOGO_URL");
export const siteName = () => filled("BUSINESS_NAME");
export const hasPhone = () => sitePhone() !== "";
export const hasEmail = () => siteEmail() !== "";

/** tel: href built from verified digits; "" when there is no verified phone. */
export function telHref(): string {
  const digits = (filled("PHONE_DIGITS") || sitePhone()).replace(/\\D+/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") return \`tel:+\${digits}\`;
  if (digits.length === 10) return \`tel:+1\${digits}\`;
  return digits ? \`tel:\${digits}\` : "";
}
`);

// ─────────────────────────────────────────────────────────── logo
write("src/components/Logo.tsx", `import { siteLogo, siteName } from "@/data/tokens";

type LogoProps = {
  className?: string;
  variant?: "dark" | "light";
  /** Pixel size for the logo image height; width auto-scales. */
  size?: "sm" | "md" | "lg" | "xl";
};

const sizeClasses: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-9 w-auto md:h-10",
  md: "h-12 w-auto md:h-14",
  lg: "h-14 w-auto md:h-20",
  xl: "h-16 w-auto md:h-24",
};

const wordmarkSize: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "text-base md:text-lg",
  md: "text-lg md:text-xl",
  lg: "text-xl md:text-3xl",
  xl: "text-2xl md:text-4xl",
};

export function Logo({ className, variant = "dark", size = "md" }: LogoProps) {
  const wrapper =
    variant === "light"
      ? "bg-white rounded-md p-1.5 shadow-sm ring-1 ring-black/5"
      : "";
  const src = siteLogo();
  const name = siteName();

  // No verified logo => set the business name as a wordmark rather than ship a
  // broken image or somebody else's mark.
  const mark = src ? (
    <img
      src={src}
      alt={name}
      className={sizeClasses[size]}
      loading="eager"
      decoding="async"
    />
  ) : (
    <span
      className={\`font-bold tracking-tight \${wordmarkSize[size]} \${
        variant === "light" ? "text-primary-deep" : "text-foreground"
      }\`}
    >
      {name}
    </span>
  );

  return (
    <div className={\`flex items-center \${className ?? ""}\`}>
      <span className={\`inline-flex items-center justify-center \${wrapper}\`}>{mark}</span>
    </div>
  );
}
`);

// ─────────────────────────────────────────────────────────── header
rewrite("src/components/sections/Header.tsx", [
  [`import { Logo } from "@/components/Logo";`,
   `import { Logo } from "@/components/Logo";\nimport { sitePhone, telHref, hasPhone } from "@/data/tokens";`],
  [`          <a
            href="tel:+15550000000"
            className="hidden md:inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-95"
          >
            <Phone className="h-4 w-4" />
            (555) 000-0000
          </a>`,
   `          {hasPhone() && (
            <a
              href={telHref()}
              className="hidden md:inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-95"
            >
              <Phone className="h-4 w-4" />
              {sitePhone()}
            </a>
          )}`],
  [`            <a
              href="tel:+15550000000"
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground"
            >
              <Phone className="h-4 w-4" /> (555) 000-0000
            </a>`,
   `            {hasPhone() && (
              <a
                href={telHref()}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground"
              >
                <Phone className="h-4 w-4" /> {sitePhone()}
              </a>
            )}`],
]);

// ─────────────────────────────────────────────────────────── hero
rewrite("src/components/sections/Hero.tsx", [
  [`import { SplitHeading } from "@/components/motion/SplitHeading";`,
   `import { SplitHeading } from "@/components/motion/SplitHeading";\nimport { sitePhone, telHref, hasPhone } from "@/data/tokens";`],
  [`            <a
              href="tel:+15550000000"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-lg shadow-primary-deep/40 transition hover:brightness-95"
            >
              <Phone className="h-5 w-5" />
              Call (555) 000-0000
            </a>`,
   `            {hasPhone() && (
              <a
                href={telHref()}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-lg shadow-primary-deep/40 transition hover:brightness-95"
              >
                <Phone className="h-5 w-5" />
                Call {sitePhone()}
              </a>
            )}`],
]);

// ─────────────────────────────────────────────────────────── footer
rewrite("src/components/sections/Footer.tsx", [
  [`import { Logo } from "@/components/Logo";`,
   `import { Logo } from "@/components/Logo";\nimport { sitePhone, siteEmail, telHref, hasPhone, hasEmail } from "@/data/tokens";`],
  [`              <li>
                <a
                  href="tel:+15550000000"
                  className="inline-flex items-center gap-2 text-cream hover:text-accent"
                >
                  <Phone className="h-4 w-4 text-accent" />
                  (555) 000-0000
                </a>
              </li>
              <li>
                <a
                  href="mailto:hello@example.com"
                  className="inline-flex items-center gap-2 text-cream hover:text-accent"
                >
                  <Mail className="h-4 w-4 text-accent" />
                  hello@example.com
                </a>
              </li>`,
   `              {hasPhone() && (
                <li>
                  <a
                    href={telHref()}
                    className="inline-flex items-center gap-2 text-cream hover:text-accent"
                  >
                    <Phone className="h-4 w-4 text-accent" />
                    {sitePhone()}
                  </a>
                </li>
              )}
              {hasEmail() && (
                <li>
                  <a
                    href={\`mailto:\${siteEmail()}\`}
                    className="inline-flex items-center gap-2 text-cream hover:text-accent"
                  >
                    <Mail className="h-4 w-4 text-accent" />
                    {siteEmail()}
                  </a>
                </li>
              )}`],
]);

// ─────────────────────────────────────────────────────────── mobile call bar
rewrite("src/components/sections/MobileCallBar.tsx", [
  [`import { Phone } from "lucide-react";`,
   `import { Phone } from "lucide-react";\nimport { sitePhone, telHref, hasPhone } from "@/data/tokens";`],
  [`      <a
        href="tel:+15550000000"
        className="flex flex-1 items-center justify-center gap-2 bg-accent py-4 text-sm font-bold text-accent-foreground shadow-lg"
      >
        <Phone className="h-4 w-4" /> Call (555) 000-0000
      </a>`,
   `      {hasPhone() && (
        <a
          href={telHref()}
          className="flex flex-1 items-center justify-center gap-2 bg-accent py-4 text-sm font-bold text-accent-foreground shadow-lg"
        >
          <Phone className="h-4 w-4" /> Call {sitePhone()}
        </a>
      )}`],
]);

// ─────────────────────────────────────────────────────────── final CTA
rewrite("src/components/sections/FinalCTA.tsx", [
  [`import { SplitHeading } from "@/components/motion/SplitHeading";`,
   `import { SplitHeading } from "@/components/motion/SplitHeading";\nimport { sitePhone, telHref, hasPhone } from "@/data/tokens";`],
  [`          <a
            href="tel:+15550000000"
            className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-md bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-lg transition hover:brightness-95"
          >
            <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Phone className="h-5 w-5" />
            Call (555) 000-0000
          </a>`,
   `          {hasPhone() && (
            <a
              href={telHref()}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-md bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-lg transition hover:brightness-95"
            >
              <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <Phone className="h-5 w-5" />
              Call {sitePhone()}
            </a>
          )}`],
  [`          Call us, or send your details and we'll get back to you. [CITY]`,
   `          Send your details and we'll get back to you. [CITY]`],
]);

// ─────────────────────────────────────────────────────────── estimate widget
rewrite("src/components/sections/EstimateWidget.tsx", [
  [`      toast.error("Could not submit. Please call (555) 000-0000.");`,
   `      toast.error(
        hasPhone()
          ? \`Could not submit. Please call \${sitePhone()}.\`
          : "Could not submit. Please try again in a moment.",
      );`],
  [`              <div className="mt-8 border-t border-border pt-5 text-center text-sm text-muted-foreground">
                Need help right now?{" "}
                <a
                  href="tel:+15550000000"
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  <Phone className="h-4 w-4" />
                  Call (555) 000-0000
                </a>
              </div>`,
   `              {hasPhone() && (
                <div className="mt-8 border-t border-border pt-5 text-center text-sm text-muted-foreground">
                  Need help right now?{" "}
                  <a
                    href={telHref()}
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    <Phone className="h-4 w-4" />
                    Call {sitePhone()}
                  </a>
                </div>
              )}`],
  [`      <a
        href="tel:+15550000000"
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
      >
        <Phone className="h-4 w-4" />
        Or call (555) 000-0000 now
      </a>`,
   `      {hasPhone() && (
        <a
          href={telHref()}
          className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground"
        >
          <Phone className="h-4 w-4" />
          Or call {sitePhone()} now
        </a>
      )}`],
]);

// ─────────────────────────────────────────────────────────── FAQ
rewrite("src/components/sections/FAQ.tsx", [
  [`import { SplitHeading } from "@/components/motion/SplitHeading";`,
   `import { SplitHeading } from "@/components/motion/SplitHeading";\nimport { sitePhone, hasPhone } from "@/data/tokens";`],
  [`  { q: "What areas do you serve?", a: "[BUSINESS_NAME] serves [CITY], [ST] and the surrounding [COUNTY] area, including [AREA_2], [AREA_3], [AREA_4], [AREA_5], [AREA_6], [AREA_7], and [AREA_8]. If you're nearby and unsure, give us a call." },`,
   `  { q: "What areas do you serve?", a: "[BUSINESS_NAME] serves [CITY], [ST] and the surrounding [COUNTY] area. If you're nearby and unsure whether we reach you, ask — we'll tell you straight." },`],
  [`  { q: "My furnace stopped working — can you help today?", a: "No-heat calls are a priority for us, especially in cold weather. The fastest way to get on the schedule is to call (555) 000-0000 directly." },`,
   `  { q: "My furnace stopped working — can you help today?", a: hasPhone() ? \`No-heat calls are a priority for us, especially in cold weather. The fastest way to get on the schedule is to call \${sitePhone()} directly.\` : "No-heat calls are a priority for us, especially in cold weather. The fastest way to get on the schedule is the free-estimate form on this page." },`],
  [`  { q: "How do I get a quote?", a: "Call (555) 000-0000, or use the free-estimate form on this page. Tell us what's going on and we'll follow up to confirm a visit." },`,
   `  { q: "How do I get a quote?", a: hasPhone() ? \`Call \${sitePhone()}, or use the free-estimate form on this page. Tell us what's going on and we'll follow up to confirm a visit.\` : "Use the free-estimate form on this page. Tell us what's going on and we'll follow up to confirm a visit." },`],
  [`export const FAQ_ITEMS = [`, `export const FAQ_ITEMS: Array<{ q: string; a: string }> = [`],
]);

// ─────────────────────────────────────────────────────────── service area
rewrite("src/components/sections/ServiceArea.tsx", [
  [`import { SplitHeading } from "@/components/motion/SplitHeading";`,
   `import { SplitHeading } from "@/components/motion/SplitHeading";\nimport { telHref, hasPhone } from "@/data/tokens";`],
  // Eight towns, seven of them invented. The engine verifies one service-area
  // city; anything past it is a claim nobody checked.
  [`const areas = ["[CITY]","[AREA_2]","[AREA_3]","[AREA_4]","[AREA_5]","[AREA_6]","[AREA_7]","[AREA_8]"];`,
   `const areas = ["[CITY]"].filter((a) => a.charAt(0) !== "[" && a.slice(0, 2) !== "{{" && a.trim() !== "");`],
  [`                [BUSINESS_NAME] is based in [CITY], [ST] and works with
                homeowners across the surrounding lake country and inland
                communities. If your town is nearby and you don't see it listed,
                give us a call — we may still be able to help.`,
   `                [BUSINESS_NAME] is based in [CITY], [ST] and works with
                homeowners across the surrounding [COUNTY] area. If your town is
                nearby and you don't see it listed, ask — we may still be able
                to help.`],
  [`            <Reveal as="div" delay={0.2}>
              <a
                href="tel:+15550000000"
                className="mt-6 inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
              >
                Not sure if we cover your area? Call us →
              </a>
            </Reveal>`,
   `            {hasPhone() && (
              <Reveal as="div" delay={0.2}>
                <a
                  href={telHref()}
                  className="mt-6 inline-flex items-center gap-2 text-base font-semibold text-primary hover:underline"
                >
                  Not sure if we cover your area? Call us →
                </a>
              </Reveal>
            )}`],
  // The chip grid is the whole right-hand column; with one verified city it
  // reads as a lone orphan chip, so it collapses instead.
  [`          <Reveal
            as="ul"
            stagger`,
   `          {areas.length > 1 && (
          <Reveal
            as="ul"
            stagger`],
  [`            ))}
          </Reveal>
        </div>`,
   `            ))}
          </Reveal>
          )}
        </div>`],
]);

// ─────────────────────────────────────────────────────────── schema
rewrite("src/pages/Index.tsx", [
  [`import { Toaster } from "@/components/ui/sonner";`,
   `import { Toaster } from "@/components/ui/sonner";\nimport { sitePhone, siteEmail } from "@/data/tokens";`],
  [`    telephone: "+1-555-000-0000",
    email: "hello@example.com",`,
   `    ...(sitePhone() ? { telephone: sitePhone() } : {}),
    ...(siteEmail() ? { email: siteEmail() } : {}),`],
  [`    areaServed: [
      { "@type": "City", name: "[CITY], [ST]" },
      { "@type": "City", name: "[AREA_2], [ST]" },
      { "@type": "City", name: "[AREA_3], [ST]" },
      { "@type": "City", name: "[AREA_4], [ST]" },
      { "@type": "City", name: "[AREA_5], [ST]" },
    ],`,
   `    areaServed: [{ "@type": "City", name: "[CITY], [ST]" }],`],
]);

// ─────────────────────────────────────────────────────────── gallery assets
const GAL = p("src/assets/gallery");
for (let i = 1; i <= 4; i++) {
  const from = path.join(GAL, `mission-gallery-${i}.jpg`);
  const to = path.join(GAL, `gallery-${i}.jpg`);
  if (fs.existsSync(from)) { fs.renameSync(from, to); edits.push(`renamed mission-gallery-${i}.jpg -> gallery-${i}.jpg`); }
}
rewrite("src/components/sections/Gallery.tsx", [
  [`import g1 from "@/assets/gallery/mission-gallery-1.jpg";
import g2 from "@/assets/gallery/mission-gallery-2.jpg";
import g3 from "@/assets/gallery/mission-gallery-3.jpg";
import g4 from "@/assets/gallery/mission-gallery-4.jpg";`,
   `import g1 from "@/assets/gallery/gallery-1.jpg";
import g2 from "@/assets/gallery/gallery-2.jpg";
import g3 from "@/assets/gallery/gallery-3.jpg";
import g4 from "@/assets/gallery/gallery-4.jpg";`],
]);
const logoPng = p("src/assets/mission-mechanical-logo.png");
if (fs.existsSync(logoPng)) { fs.unlinkSync(logoPng); edits.push("deleted src/assets/mission-mechanical-logo.png (no longer imported)"); }

// ─────────────────────────────────────────────────────────── index.html
rewrite("index.html", [
  [`content="[BUSINESS_NAME] provides residential furnace and AC repair, installation, and maintenance in [CITY], [ST] and the surrounding [COUNTY] area. Call (555) 000-0000."`,
   `content="[BUSINESS_NAME] provides residential furnace and AC repair, installation, and maintenance in [CITY], [ST] and the surrounding [COUNTY] area."`],
]);

console.log(edits.map((e) => "  · " + e).join("\n"));
console.log("\nsanitized OK");
