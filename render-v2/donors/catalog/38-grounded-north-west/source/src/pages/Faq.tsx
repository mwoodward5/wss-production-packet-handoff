import { Seo } from "@/components/site/Seo";
import { PageHero } from "@/components/site/PageHero";
import { ContactClose } from "@/components/site/ContactClose";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useClient } from "@/lib/wss";

const Faq = () => {
const c=useClient(), faqs=c.content.faqs;
const schema=faqs.length ? {"@context":"https://schema.org","@type":"FAQPage",mainEntity:faqs.map(f=>({"@type":"Question",name:f.q,acceptedAnswer:{"@type":"Answer",text:f.a}}))} : undefined;
return (
  <>
    <Seo title={"FAQ | " + c.identity.businessName} description="" path="/faq" schema={schema} />
    <PageHero eyebrow="FAQ" title={<>Questions <span className="copper-text italic">&amp; answers</span></>} intro="" imageAlt="" />
    <section className="container py-16 max-w-3xl">
      <Accordion type="single" collapsible className="w-full">
        {faqs.map((f, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger className="text-left font-display text-lg">{f.q}</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
    <ContactClose />
  </>
);
};

export default Faq;
