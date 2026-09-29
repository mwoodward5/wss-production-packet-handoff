import type { LegalDoc } from "@/lib/legal";

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <section className="mx-auto max-w-3xl px-5 pt-6 pb-20 md:px-8 md:pb-28">
      <div className="eyebrow">Legal</div>
      <h1 className="display mt-2 text-4xl md:text-5xl">{doc.title}</h1>
      <div className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
        <div className="font-semibold text-foreground">{doc.org}</div>
        <div className="mt-1">{doc.effective}</div>
        <div>{doc.updated}</div>
      </div>

      <div className="mt-8 space-y-5 text-[0.975rem] leading-relaxed text-foreground/85">
        {doc.blocks.map((block, i) => {
          if (block.kind === "h2") {
            return (
              <h2
                key={i}
                className="display pt-5 text-xl text-foreground md:text-2xl"
              >
                {block.text}
              </h2>
            );
          }
          if (block.kind === "ul") {
            return (
              <ul key={i} className="ml-5 list-disc space-y-2">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          }
          return <p key={i}>{block.text}</p>;
        })}
      </div>
    </section>
  );
}
