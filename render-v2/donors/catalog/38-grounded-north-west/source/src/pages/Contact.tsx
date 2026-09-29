import { Seo } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { GoogleReviewButton, BbbSeal, GeneracDealerBadge } from "@/components/site/ReviewsTrust";
import { useClient, useSitePlan, introCopy, paragraphs, Copy } from "@/lib/wss";

const Contact = () => {
const c=useClient(), plan=useSitePlan();
return (
  <>
    <Seo title={"Contact | " + c.identity.businessName} description={c.content.ctaBody} path="/contact" />
    <PageHero eyebrow="Contact" title={<>{c.identity.businessName} <span className="copper-text italic">contact</span></>} intro={introCopy(plan.content.contact) || c.content.ctaBody} imageAlt="" />
    {paragraphs(plan.content.contact).filter(p=>!p.startsWith('#')).length>1 && <div className="container pt-12 space-y-5"><Copy text={paragraphs(plan.content.contact).filter(p=>!p.startsWith('#')).slice(1).join('\n\n')}/></div>}
    <ContactClose heading="Get in touch." />
    {(c.trust.reviews.length > 0 || c.trust.aggregate || c.trust.badges.length > 0) && <section className="container pb-24">
      <div className="rounded-2xl border border-border bg-card p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-secondary mb-2">Reviews & Trust</div>
          <h2 className="font-display text-2xl">Reviews &amp; credentials</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md"></p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <GoogleReviewButton />
          <BbbSeal />
          <GeneracDealerBadge />
        </div>
      </div>
      {c.trust.reviews.length > 0 && <div className="mt-6 grid md:grid-cols-3 gap-6">
        {c.trust.reviews.map((r,i)=><blockquote key={i} className="rounded-2xl border border-border bg-card p-6"><p>{r.text}</p><footer className="mt-4 text-sm"><a href={r.sourceUrl} rel="noopener noreferrer" target="_blank">{r.author}</a>{r.rating!==null && <span> · {r.rating}/5</span>}</footer></blockquote>)}
      </div>}
    </section>}
  </>
);
};

export default Contact;
