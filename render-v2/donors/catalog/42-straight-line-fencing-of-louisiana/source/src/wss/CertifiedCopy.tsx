// Small text-only Markdown view for the compiler's visitor-copy fields.
// No HTML, remote embeds, images or executable links are promoted from copy.
export function CertifiedCopy({ text, className = '' }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/).filter(Boolean);
  return <div className={className}>
    {blocks.map((block, i) => {
      const heading = /^(#{1,6})\s+([^\n]+)$/.exec(block);
      if (heading) return <h3 key={i} className="font-serif text-2xl leading-tight mt-8 mb-4">{heading[2]}</h3>;
      const lines = block.split('\n');
      if (lines.every(line => /^[-*]\s+/.test(line))) return <ul key={i} className="list-disc pl-6 my-4 space-y-2">{lines.map((line, j) => <li key={j}>{line.replace(/^[-*]\s+/, '')}</li>)}</ul>;
      if (lines.every(line => /^\d+\.\s+/.test(line))) return <ol key={i} className="list-decimal pl-6 my-4 space-y-2">{lines.map((line, j) => <li key={j}>{line.replace(/^\d+\.\s+/, '')}</li>)}</ol>;
      return <p key={i} className="whitespace-pre-line mb-5 last:mb-0">{block}</p>;
    })}
  </div>;
}
