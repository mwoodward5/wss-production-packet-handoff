import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export type FaqItem = { q: string; a: string };

export function FAQ({ items }: { items: FaqItem[] }) {
  return (
    <Accordion type="single" collapsible className="w-full divide-y divide-border rounded-2xl border border-border bg-card shadow-card">
      {items.map((it, i) => (
        <AccordionItem key={i} value={`item-${i}`} className="border-0 px-5">
          <AccordionTrigger className="text-left text-base font-semibold hover:no-underline">
            {it.q}
          </AccordionTrigger>
          <AccordionContent className="text-muted-foreground">{it.a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
