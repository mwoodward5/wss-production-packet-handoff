import {client} from "@/lib/bridge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { jsonLdScript, ldBreadcrumbs, pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: pageMeta({
      title: client.identity.businessName+" | Privacy",
      description: "Privacy information",
      path: "/privacy-policy",
    }),
    scripts: [jsonLdScript(ldBreadcrumbs([{ name: "Home", path: "/" }, { name: "Privacy Policy", path: "/privacy-policy" }]))],
  }),
  component: PrivacyPolicyPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-[26px] lg:text-[32px] leading-tight text-ink">{title}</h2>
      <div className="mt-3 space-y-4 text-[16px] leading-relaxed text-foreground/80">{children}</div>
    </section>
  );
}

function PrivacyPolicyPage() {
  return (
    <section className="bg-bone">
      <div className="mx-auto max-w-[820px] px-6 lg:px-10 pt-16 lg:pt-24 pb-24">
        <nav className="eyebrow"><Link to="/">Home</Link> / <span className="text-ink">Privacy Policy</span></nav>
        <h1 className="mt-6 font-display text-[44px] lg:text-[64px] leading-[1.02] text-ink">Privacy Policy</h1>
        <Section title="Contact about privacy"><p>A client privacy policy has not been supplied.</p><a href={client.identity.phoneTel}>{client.identity.phoneDisplay}</a></Section>
      </div>
    </section>
  );
}
